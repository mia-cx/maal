/**
 * D1 reads and writes for immutable recipe versions (spec §5.2, §8.7), shared by the user and
 * household sync repositories and the MCP domain port.
 */
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	householdSeesVersion,
	ownerStanding,
	type MealResolutionContext
} from '$lib/domain/meals/recipe-following.js';
import {
	MealCheckInSchema,
	isRecipeFollowingMeal,
	type LiveMeal,
	type RecipeFollowingMeal
} from '$lib/domain/meals/schema.js';
import { RecipeVersionSchema, type RecipeVersion } from '$lib/domain/recipes/versions.js';
import type { HouseholdSyncChange } from '$lib/sync/household-contracts.js';

import { JSON_IDS, camelize, queryAll, type SqlValue } from './d1-snapshot.js';

/** The `recipe_versions` row of a version; its recipe is stored whole as JSON. */
export const recipeVersionRow = (version: Record<string, unknown>): Record<string, SqlValue> => ({
	id: String(version.id),
	owner_user_id: String(version.ownerUserId),
	recipe_id: String(version.recipeId),
	effective_at: String(version.effectiveAt),
	recipe: version.recipe === null ? null : JSON.stringify(version.recipe),
	schema_version: Number(version.schemaVersion),
	revision: Number(version.revision),
	created_at: String(version.createdAt),
	updated_at: String(version.updatedAt),
	deleted_at: (version.deletedAt as string | null) ?? null
});

/** The version a `recipe_versions` row holds, before its conflict clocks are attached. */
export const recipeVersionFromRow = (row: Record<string, unknown>): Record<string, unknown> => {
	const record = camelize(row);
	return {
		...record,
		recipe: typeof record.recipe === 'string' ? JSON.parse(record.recipe) : null
	};
};

/** Every stored version of these recipes, decoded. Undecodable rows are left out. */
export const readRecipeVersions = async (
	database: D1Database,
	recipeIds: readonly string[]
): Promise<RecipeVersion[]> => {
	const unique = [...new Set(recipeIds)];
	if (unique.length === 0) return [];
	return decodeVersionRows(
		await queryAll(
			database,
			`SELECT * FROM recipe_versions WHERE recipe_id IN (${JSON_IDS})`,
			JSON.stringify(unique)
		)
	);
};

/**
 * The versions of these recipes that a household sees (spec §8.7), by {@link householdSeesVersion}
 * over the owner's membership in the household, which is unique per household and user. A
 * membership that is not active ended at its `updated_at`.
 */
export const readHouseholdVersions = async (
	database: D1Database,
	householdId: string,
	recipeIds: readonly string[]
): Promise<RecipeVersion[]> => {
	const unique = [...new Set(recipeIds)];
	if (unique.length === 0) return [];
	const rows = await queryAll<
		Record<string, unknown> & {
			id: string;
			owner_status: string | null;
			owner_updated_at: string;
		}
	>(
		database,
		`SELECT v.*, hm.status AS owner_status, hm.updated_at AS owner_updated_at
		 FROM recipe_versions v LEFT JOIN household_memberships hm
		  ON hm.household_id = ? AND hm.workos_user_id = v.owner_user_id
		 WHERE v.recipe_id IN (${JSON_IDS})`,
		householdId,
		JSON.stringify(unique)
	);
	const standings = new Map(
		rows.map(({ id, owner_status, owner_updated_at }) => [
			id,
			ownerStanding(
				owner_status === null ? [] : [owner_status === 'active' ? null : owner_updated_at]
			)
		])
	);
	// Decoding drops the joined membership columns.
	return decodeVersionRows(rows).filter((version) =>
		householdSeesVersion(version, standings.get(version.id))
	);
};

const decodeVersionRows = (rows: readonly Record<string, unknown>[]): RecipeVersion[] =>
	rows.flatMap((row) => {
		try {
			return [
				Schema.decodeUnknownSync(RecipeVersionSchema)({
					...recipeVersionFromRow(row),
					conflictClocks: {}
				})
			];
		} catch {
			return [];
		}
	});

/**
 * Reads what these meals resolve against in D1: the versions of their recipes that each meal's
 * household receives (spec §8.7), the live check-ins on them, and their households' timezones
 * (spec §5.3). The same rule as on a device, from the same data.
 */
export const loadMealResolution = async (
	database: D1Database,
	meals: readonly LiveMeal[]
): Promise<(meal: RecipeFollowingMeal) => MealResolutionContext> => {
	const following = meals.filter(isRecipeFollowingMeal);
	if (following.length === 0) return () => ({ versions: [], checkIns: [], timeZone: null });
	const [versionsByHousehold, checkInRows, timeZoneRows] = await Promise.all([
		Promise.all(
			[...Map.groupBy(following, ({ householdId }) => householdId)].map(
				async ([householdId, householdMeals]) => {
					const versions = await readHouseholdVersions(
						database,
						householdId,
						householdMeals.map(({ sourceRecipeId }) => sourceRecipeId)
					);
					return [householdId, Map.groupBy(versions, ({ recipeId }) => recipeId)] as const;
				}
			)
		).then((entries) => new Map(entries)),
		queryAll(
			database,
			`SELECT * FROM meal_check_ins WHERE deleted_at IS NULL AND meal_id IN (${JSON_IDS})`,
			JSON.stringify(following.map(({ id }) => id))
		),
		queryAll<{ household_id: string; timezone: string | null }>(
			database,
			`SELECT household_id, timezone FROM households WHERE household_id IN (${JSON_IDS})`,
			JSON.stringify([...new Set(following.map(({ householdId }) => householdId))])
		)
	]);
	const checkIns = checkInRows.flatMap((row) => {
		try {
			return [
				Schema.decodeUnknownSync(MealCheckInSchema)({
					...camelize(row, ['household_id']),
					conflictClocks: {}
				})
			];
		} catch {
			return [];
		}
	});
	const checkInsByMeal = Map.groupBy(checkIns, ({ mealId }) => mealId);
	const timeZones = new Map(timeZoneRows.map((row) => [row.household_id, row.timezone]));
	return (meal) => ({
		versions: versionsByHousehold.get(meal.householdId)?.get(meal.sourceRecipeId) ?? [],
		checkIns: checkInsByMeal.get(meal.id) ?? [],
		timeZone: timeZones.get(meal.householdId) ?? null
	});
};

/** The newest change sequence in D1. Sequences are global, so every later commit gets a higher one. */
export const LATEST_SEQUENCE_SQL = '(SELECT COALESCE(MAX(seq), 0) FROM sync_changes)';

/**
 * 1 when a live recipe-following meal of the recipe bound to the first `?` was written after the
 * sequence bound to the second, else 0.
 */
export const FOLLOWING_MEAL_WRITTEN_SINCE_SQL = `(EXISTS (SELECT 1 FROM meals m
	JOIN sync_entity_versions v ON v.audience_kind = 'household' AND v.audience_id = m.household_id
	 AND v.entity_kind = 'meal' AND v.entity_id = m.id
	WHERE m.followed_recipe_id = ? AND m.deleted_at IS NULL AND v.last_sequence > ?))`;

/** The newest sequence of any version of the recipe bound to `?` in its owner's user audience. */
export const VERSION_HEAD_SQL = `(SELECT COALESCE(MAX(v.last_sequence), 0) FROM sync_entity_versions v
	JOIN recipe_versions r ON r.id = v.entity_id
	WHERE v.audience_kind = 'user' AND v.entity_kind = 'recipeVersion' AND r.recipe_id = ?)`;

/**
 * Households that hold a live recipe-following meal of `recipeId` and that its owner still belongs
 * to: the households a new version of the recipe is shared with (spec §8.7).
 */
export const householdsReceivingRecipe = async (
	database: D1Database,
	recipeId: string,
	ownerUserId: string
): Promise<string[]> =>
	(
		await queryAll<{ household_id: string }>(
			database,
			`SELECT DISTINCT m.household_id FROM meals m
			 WHERE m.followed_recipe_id = ? AND m.deleted_at IS NULL
			 AND EXISTS (SELECT 1 FROM household_memberships hm WHERE hm.household_id = m.household_id
			  AND hm.workos_user_id = ? AND hm.status = 'active')
			 ORDER BY m.household_id`,
			recipeId,
			ownerUserId
		)
	).map(({ household_id }) => household_id);

/**
 * Statements that share `versions` with each household as pull-only household `recipeVersion`
 * changes, and move each household's latest sequence (spec §8.7). Append them to the batch that
 * commits the version or the meal.
 */
export const sharedVersionStatements = (
	database: D1Database,
	input: {
		readonly versions: readonly RecipeVersion[];
		readonly householdIds: readonly string[];
		readonly actorUserId: string;
		readonly deviceId: string;
		readonly occurredAt: string;
		readonly receivedAt: string;
	}
): D1PreparedStatement[] =>
	input.householdIds.flatMap((householdId) =>
		input.versions.flatMap((version) => {
			const mutationId = uuidv7();
			return [
				database
					.prepare(
						`INSERT INTO sync_changes
						 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
						  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
						  payload, tombstone_expires_at)
						 VALUES (?, ?, ?, 'household', ?, 'recipeVersion', ?, 'shared', 'upsert', 1, ?, ?, ?, NULL)`
					)
					.bind(
						mutationId,
						input.actorUserId,
						input.deviceId,
						householdId,
						version.id,
						input.occurredAt,
						input.receivedAt,
						JSON.stringify({
							schemaVersion: CURRENT_SCHEMA_VERSION,
							payload: { conflictGroups: ['shared'], aggregate: version }
						})
					),
				database
					.prepare(
						`INSERT INTO sync_scope_state
						 (audience_kind, audience_id, bootstrap_generation, earliest_retained_sequence,
						  latest_sequence, updated_at)
						 VALUES ('household', ?, 1, 0, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?)
						 ON CONFLICT(audience_kind, audience_id) DO UPDATE SET
						  latest_sequence = excluded.latest_sequence, updated_at = excluded.updated_at`
					)
					.bind(householdId, mutationId, input.receivedAt)
			];
		})
	);

/** A bootstrap entry for a version the household's recipe-following meals resolve among. */
export const sharedVersionSnapshot = (
	version: RecipeVersion,
	sequence: number
): HouseholdSyncChange => ({
	sequence,
	mutationId: uuidv7(),
	originDeviceId: uuidv7(),
	actorUserId: version.ownerUserId,
	entityKind: 'recipeVersion',
	entityId: version.id,
	conflictGroups: ['shared'],
	operation: 'upsert',
	resultingRevision: 1,
	occurredAt: version.effectiveAt,
	receivedAt: version.effectiveAt,
	aggregate: version,
	tombstoneExpiresAt: null
});
