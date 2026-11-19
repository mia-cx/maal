import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	DEFAULT_STALENESS_THRESHOLD_MINUTES,
	isRecentEdit
} from '$lib/domain/household/staleness.js';
import {
	copyRecipeIntoMeal,
	freezesBeforeRecipeChange,
	householdToday
} from '$lib/domain/meals/recipe-following.js';
import {
	MEAL_CONTENT_GROUPS,
	MEAL_COPY_GROUPS,
	RecipeFollowingMealSchema,
	isLiveMeal,
	isRecipeFollowingMeal,
	type StoredMeal
} from '$lib/domain/meals/schema.js';
import {
	StoredRecipeSchema,
	type RecipeAggregate,
	type StoredRecipe
} from '$lib/domain/recipes/schema.js';
import type { MutationReceipt } from '$lib/sync/contracts.js';
import {
	MEAL_ALREADY_COPIED,
	RECIPE_NOT_SHARED,
	type HouseholdSyncChange,
	type HouseholdSyncEntityKind,
	type HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';
import { decodeHouseholdSyncAggregate } from '$lib/sync/household-entities.js';
import { pruneSyncRetentionBatch } from '$lib/server/maintenance/sync-retention.js';

import {
	COMMIT_RACED,
	JSON_IDENTITIES,
	JSON_IDS,
	MAX_COMMIT_ATTEMPTS,
	assertIdentifier,
	camelize,
	commitGuardSql,
	entityHeadSql,
	groupBy,
	heldManifestKeys,
	identitiesJson,
	kindLiteral,
	listHeldIdentities,
	markReinstated,
	queryAll,
	readCommitGuard,
	readSidecars,
	type CommitGuard,
	type CommitResult,
	type EntityIdentity,
	type SqlValue
} from './d1-snapshot.js';
import { ServerSyncUnavailable } from './errors.js';
import { incomingWinsHistoricalConflict, type WinningClock } from './reconciliation.js';
import {
	householdSyncEntityKey,
	type HouseholdServerBootstrapPage,
	type HouseholdServerBootstrapPageRequest,
	type HouseholdServerSyncPage,
	type HouseholdServerSyncScopeState,
	type HouseholdSyncRepository
} from './household-repository.js';

interface ScopeRow {
	bootstrap_generation: number;
	earliest_retained_sequence: number;
	latest_sequence: number;
}

interface ChangeRow {
	seq: number;
	mutation_id: string;
	actor_user_id: string;
	origin_device_id: string;
	entity_kind: string;
	entity_id: string;
	conflict_group: string;
	operation: 'upsert' | 'delete';
	resulting_revision: number;
	occurred_at: string;
	received_at: string;
	payload: string;
	tombstone_expires_at: string | null;
}

interface ReceiptRow {
	mutation_id: string;
	status: 'accepted' | 'rejected';
	sequence: number | null;
	resulting_revision: number | null;
	error_code: string | null;
}

interface VersionRow {
	conflict_group: string;
	revision: number;
	last_sequence: number;
	winning_occurred_at: string;
	winning_origin_device_id: string;
	winning_mutation_id: string;
	winning_actor_user_id: string | null;
	winning_received_at: string | null;
}

interface StoredChangePayload {
	schemaVersion: 1;
	payload: { conflictGroups: string[]; aggregate: unknown; reinstated?: true };
}

const HOUSEHOLD_TABLES = {
	household: 'households',
	householdAppliance: 'household_appliances',
	foodHouseholdAlias: 'food_household_aliases',
	foodHouseholdEntry: 'food_household_entries',
	unitHouseholdAlias: 'unit_household_aliases',
	unitHouseholdEntry: 'unit_household_entries',
	householdFoodDisplayPreference: 'household_food_display_overrides',
	householdUnitDisplayPreference: 'household_unit_display_overrides'
} as const;

const HOUSEHOLD_TABLE_COLUMNS = {
	household: [
		'householdId',
		'name',
		'locale',
		'timezone',
		'weekStartsOn',
		'defaultPlannedYield',
		'preferredDinnerTime',
		'stalenessThresholdMinutes',
		'createdByUserId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	householdAppliance: [
		'id',
		'householdId',
		'appliance',
		'available',
		'notes',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	foodHouseholdAlias: [
		'id',
		'householdId',
		'foodId',
		'alias',
		'locale',
		'sourceDomain',
		'adoptionStatus',
		'defaultMeasureUnitId',
		'defaultMeasureBaseUnitId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	foodHouseholdEntry: [
		'id',
		'householdId',
		'canonicalLabel',
		'defaultMeasureUnitId',
		'defaultMeasureBaseUnitId',
		'adoptionStatus',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	unitHouseholdAlias: [
		'id',
		'householdId',
		'unitId',
		'baseUnitId',
		'alias',
		'pluralAlias',
		'locale',
		'sourceDomain',
		'adoptionStatus',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	unitHouseholdEntry: [
		'id',
		'householdId',
		'canonicalLabel',
		'baseUnitId',
		'toBaseFactor',
		'toBaseOffset',
		'adoptionStatus',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	householdFoodDisplayPreference: [
		'id',
		'householdId',
		'preferredFoodAliasScope',
		'foodId',
		'locale',
		'preferredFoodAliasId',
		'preferredMeasureUnitId',
		'preferredMeasureBaseUnitId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	householdUnitDisplayPreference: [
		'id',
		'householdId',
		'preferredUnitAliasScope',
		'baseUnitId',
		'locale',
		'preferredUnitId',
		'preferredUnitAliasId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	]
} as const satisfies Record<keyof typeof HOUSEHOLD_TABLES, readonly string[]>;

const MEAL_PARENT_COLUMNS = [
	'id',
	'householdId',
	'sourceRecipeId',
	'title',
	'description',
	'imageUrl',
	'date',
	'time',
	'sortOrder',
	'plannedCookUserId',
	'yield',
	'plannedYield',
	'status',
	'prepTimeMinutes',
	'cookTimeMinutes',
	'totalTimeMinutes',
	'sourceYieldText',
	'sourceDatePublished',
	'sourceDateModified',
	'sourceLanguage',
	'sourceUrl',
	'sourceSiteName',
	'sourceAuthorName',
	'sourcePublisherName',
	'sourceIsBasedOnUrl',
	'sourceImportedAt',
	'sourceHtmlHash',
	'sourceRatingValue',
	'sourceRatingCount',
	'sourceReviewCount',
	'sourceClaimedMinutes',
	'parseConfidence',
	'ingredientConfidence',
	'instructionConfidence',
	'nutritionConfidence',
	'notes',
	'schemaVersion',
	'revision',
	'createdAt',
	'updatedAt',
	'deletedAt'
] as const;

const CHECK_IN_COLUMNS = [
	'id',
	'reporterUserId',
	'mealId',
	'cookTimeMinutes',
	'verdict',
	'reason',
	'schemaVersion',
	'revision',
	'createdAt',
	'updatedAt',
	'deletedAt'
] as const;

const MEAL_SIDE_CARS = [
	['ingredients', 'meal_ingredients', 'mealId'],
	['instructions', 'meal_instructions', 'mealId'],
	['instructionEvents', 'meal_instruction_events', null],
	['applianceRequirements', 'meal_appliance_requirements', 'mealId'],
	['classifications', 'meal_classifications', 'mealId'],
	['media', 'meal_media', 'mealId'],
	['nutritionFacts', 'meal_nutrition_facts', 'mealId']
] as const;

const camelToSnake = (value: string): string =>
	value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const sqlValue = (value: unknown): SqlValue => {
	if (value === undefined) return null;
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		value instanceof ArrayBuffer
	) {
		return value;
	}
	if (typeof value === 'boolean') return value ? 1 : 0;
	throw new TypeError('A normalized D1 column received a non-scalar value.');
};

const pickSnake = (
	source: Record<string, unknown>,
	keys: readonly string[]
): Record<string, SqlValue> =>
	Object.fromEntries(keys.map((key) => [camelToSnake(key), sqlValue(source[key])])) as Record<
		string,
		SqlValue
	>;

const upsert = (
	database: D1Database,
	table: string,
	row: Record<string, SqlValue>,
	conflictColumns: readonly string[] = ['id']
): D1PreparedStatement => {
	const columns = Object.keys(row);
	const updates = columns.filter((column) => !conflictColumns.includes(column));
	const sql = `INSERT INTO ${assertIdentifier(table)} (${columns.map(assertIdentifier).join(', ')})
		VALUES (${columns.map(() => '?').join(', ')})
		ON CONFLICT (${conflictColumns.map(assertIdentifier).join(', ')}) DO UPDATE SET
		${updates.map((column) => `${assertIdentifier(column)} = excluded.${assertIdentifier(column)}`).join(', ')}`;
	return database.prepare(sql).bind(...columns.map((column) => row[column]!));
};

const decodeStoredPayload = (encoded: string): StoredChangePayload => {
	const value: unknown = JSON.parse(encoded);
	if (
		typeof value !== 'object' ||
		value === null ||
		(value as { schemaVersion?: unknown }).schemaVersion !== CURRENT_SCHEMA_VERSION
	) {
		throw new TypeError('Unsupported persisted sync payload.');
	}
	const payload = (value as { payload?: unknown }).payload;
	if (typeof payload !== 'object' || payload === null) {
		throw new TypeError('Malformed persisted sync payload.');
	}
	const candidate = payload as {
		conflictGroups?: unknown;
		aggregate?: unknown;
		reinstated?: unknown;
	};
	if (
		!Array.isArray(candidate.conflictGroups) ||
		!candidate.conflictGroups.every((group) => typeof group === 'string')
	) {
		throw new TypeError('Malformed persisted conflict groups.');
	}
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		payload: {
			conflictGroups: candidate.conflictGroups,
			aggregate: candidate.aggregate,
			...(candidate.reinstated === true ? { reinstated: true as const } : {})
		}
	};
};

const changeFromRow = (row: ChangeRow): HouseholdSyncChange => {
	const stored = decodeStoredPayload(row.payload);
	return {
		sequence: row.seq,
		mutationId: row.mutation_id,
		originDeviceId: row.origin_device_id,
		actorUserId: row.actor_user_id,
		entityKind: row.entity_kind as HouseholdSyncEntityKind,
		entityId: row.entity_id,
		conflictGroups: stored.payload.conflictGroups as [string, ...string[]],
		operation: row.operation,
		resultingRevision: row.resulting_revision,
		occurredAt: row.occurred_at as `${string}Z`,
		receivedAt: row.received_at as `${string}Z`,
		aggregate: stored.payload.aggregate,
		tombstoneExpiresAt: row.tombstone_expires_at as `${string}Z` | null,
		...(stored.payload.reinstated ? { reinstated: true as const } : {})
	};
};

const receiptFromRow = (row: ReceiptRow, duplicate = false): MutationReceipt => {
	if (row.status === 'accepted' && row.sequence !== null && row.resulting_revision !== null) {
		return {
			mutationId: row.mutation_id,
			status: duplicate ? 'duplicate' : 'accepted',
			sequence: row.sequence,
			resultingRevision: row.resulting_revision
		};
	}
	return {
		mutationId: row.mutation_id,
		status: 'rejected',
		sequence: null,
		resultingRevision: null,
		errorCode: row.error_code ?? 'rejected'
	};
};

const isContentGroup = (group: string): boolean =>
	(MEAL_CONTENT_GROUPS as readonly string[]).includes(group);

/**
 * True for a copy mutation, which writes `source` and content groups only (spec §5.3). A mutation
 * that also writes the meal's own groups, such as an archive's Replace, is a full replacement.
 */
const isCopyOnly = (groups: readonly string[]): boolean =>
	groups.includes('source') &&
	groups.every((group) => (MEAL_COPY_GROUPS as readonly string[]).includes(group));

/** The newest sequence among the live recipe-following meals of the recipe bound to `?`. */
export const FOLLOWING_MEALS_HEAD_SQL = `(SELECT COALESCE(MAX(v.last_sequence), 0) FROM meals m
	JOIN sync_entity_versions v ON v.audience_kind = 'household' AND v.audience_id = m.household_id
	 AND v.entity_kind = 'meal' AND v.entity_id = m.id
	WHERE m.source_recipe_id = ? AND m.follows_recipe = 1 AND m.deleted_at IS NULL)`;

/** The newest sequence of the recipe bound to `?` in its owner's user audience. */
const RECIPE_HEAD_SQL = `(SELECT COALESCE(MAX(last_sequence), 0) FROM sync_entity_versions
	WHERE audience_kind = 'user' AND entity_kind = 'recipe' AND entity_id = ?)`;

/**
 * True when this upsert turns a recipe-following meal into a meal copy: it carries the `source`
 * group and a copy (spec §5.3).
 */
const copiesMeal = (current: unknown, incoming: unknown, groups: readonly string[]): boolean =>
	current !== null &&
	isLiveMeal(current as StoredMeal) &&
	isRecipeFollowingMeal(current as StoredMeal) &&
	isLiveMeal(incoming as StoredMeal) &&
	!isRecipeFollowingMeal(incoming as StoredMeal) &&
	groups.includes('source');

/**
 * Merges the accepted groups of an incoming meal into the current one. A copy takes every content
 * field from the incoming meal; a meal that stays recipe-following never takes content, and a meal
 * copy never goes back to following.
 */
const mergeMeal = (
	currentInput: unknown | null,
	incomingInput: unknown,
	acceptedGroups: readonly string[],
	revision: number,
	clock: WinningClock
): unknown => {
	const incoming = incomingInput as StoredMeal;
	const current = currentInput as StoredMeal | null;
	if (current === null || !isLiveMeal(current) || !isLiveMeal(incoming)) {
		return { ...incoming, revision, updatedAt: clock.occurredAt };
	}
	const becomesCopy = copiesMeal(current, incoming, acceptedGroups);
	const staysFollowing = isRecipeFollowingMeal(current) && !becomesCopy;
	const next: Record<string, unknown> = { ...current };
	if (becomesCopy) delete next.followsRecipe;
	const incomingRecord: Record<string, unknown> = { ...incoming };
	const header = [
		'sourceRecipeId',
		'title',
		'description',
		'imageUrl',
		'yield',
		'prepTimeMinutes',
		'cookTimeMinutes',
		'totalTimeMinutes',
		'sourceYieldText',
		'sourceDatePublished',
		'sourceDateModified',
		'sourceLanguage',
		'sourceUrl',
		'sourceSiteName',
		'sourceAuthorName',
		'sourcePublisherName',
		'sourceIsBasedOnUrl',
		'sourceImportedAt',
		'sourceHtmlHash',
		'sourceRatingValue',
		'sourceRatingCount',
		'sourceReviewCount',
		'sourceClaimedMinutes',
		'parseConfidence',
		'ingredientConfidence',
		'instructionConfidence',
		'nutritionConfidence',
		'notes'
	];
	const groupFields: Record<string, readonly string[]> = {
		header,
		schedule: ['date', 'time', 'sortOrder', 'plannedCookUserId', 'plannedYield'],
		status: ['status'],
		ingredients: ['ingredients'],
		instructions: ['instructions', 'instructionEvents'],
		appliances: ['applianceRequirements'],
		classifications: ['classifications'],
		media: ['media'],
		nutrition: ['nutritionFacts'],
		deletion: ['deletedAt']
	};
	for (const group of acceptedGroups) {
		if (group === 'source') continue;
		if (isContentGroup(group) && (staysFollowing || isRecipeFollowingMeal(incoming))) continue;
		for (const field of groupFields[group] ?? header) next[field] = incomingRecord[field];
	}
	const clocks = { ...current.conflictClocks };
	for (const group of acceptedGroups) clocks[group] = clock;
	return { ...next, revision, updatedAt: clock.occurredAt, conflictClocks: clocks };
};

/** The fields a recipe-following meal row stores; its content columns are null (spec §5.3). */
const followingMealFromRow = (
	row: Record<string, unknown>,
	conflictClocks: Record<string, unknown>
): unknown => {
	const record = camelize(row);
	return {
		schemaVersion: record.schemaVersion,
		revision: record.revision,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
		conflictClocks,
		id: record.id,
		householdId: record.householdId,
		sourceRecipeId: record.sourceRecipeId,
		followsRecipe: true,
		date: record.date,
		time: record.time,
		sortOrder: record.sortOrder,
		plannedCookUserId: record.plannedCookUserId,
		plannedYield: record.plannedYield,
		status: record.status
	};
};

/**
 * The current D1 recipes, keyed by ID, as their owner's user audience serves them: the newest
 * retained change, else the normalized row. Undecodable or missing recipes are left out.
 */
export const readCurrentRecipes = async (
	database: D1Database,
	recipeIds: readonly string[]
): Promise<Map<string, StoredRecipe>> => {
	const unique = [...new Set(recipeIds)];
	if (unique.length === 0) return new Map();
	const latest = await queryAll<{ entity_id: string; payload: string }>(
		database,
		`SELECT entity_id, payload, MAX(seq) AS seq FROM sync_changes
		 WHERE audience_kind = 'user' AND entity_kind = 'recipe' AND entity_id IN (${JSON_IDS})
		 GROUP BY entity_id`,
		JSON.stringify(unique)
	);
	const found = new Map<string, unknown>(
		latest.map((row) => [row.entity_id, decodeStoredPayload(row.payload).payload.aggregate])
	);
	const rest = unique.filter((id) => !found.has(id));
	if (rest.length > 0) {
		const [rows, sidecars, versions] = await Promise.all([
			queryAll(database, `SELECT * FROM recipes WHERE id IN (${JSON_IDS})`, JSON.stringify(rest)),
			readSidecars(database, 'recipe', rest),
			queryAll<VersionRow & { entity_id: string }>(
				database,
				`SELECT entity_id, conflict_group, revision, last_sequence, winning_occurred_at,
				 winning_origin_device_id, winning_mutation_id, winning_actor_user_id, winning_received_at
				 FROM sync_entity_versions
				 WHERE audience_kind = 'user' AND entity_kind = 'recipe' AND entity_id IN (${JSON_IDS})`,
				JSON.stringify(rest)
			)
		]);
		const versionsById = groupBy(versions, ({ entity_id }) => entity_id);
		for (const row of rows) {
			const id = String(row.id);
			found.set(id, {
				...camelize(row),
				conflictClocks: conflictClocks(versionsById.get(id) ?? []),
				searchTokens: [],
				...sidecars.get(id)
			});
		}
	}
	const recipes = new Map<string, StoredRecipe>();
	for (const [id, value] of found) {
		try {
			recipes.set(id, Schema.decodeUnknownSync(StoredRecipeSchema)(value));
		} catch {
			// A recipe that no longer matches its contract is not shared.
		}
	}
	return recipes;
};

/**
 * Households that hold a live recipe-following meal of `recipeId` and that its owner still
 * belongs to: the households a change to the recipe is shared with (spec §8.7).
 */
export const householdsFollowingRecipe = async (
	database: D1Database,
	recipeId: string,
	ownerUserId: string
): Promise<string[]> =>
	(
		await queryAll<{ household_id: string }>(
			database,
			`SELECT DISTINCT m.household_id FROM meals m
			 WHERE m.source_recipe_id = ? AND m.follows_recipe = 1 AND m.deleted_at IS NULL
			 AND EXISTS (SELECT 1 FROM household_memberships hm WHERE hm.household_id = m.household_id
			  AND hm.workos_user_id = ? AND hm.status = 'active')
			 ORDER BY m.household_id`,
			recipeId,
			ownerUserId
		)
	).map(({ household_id }) => household_id);

/**
 * Statements that share `recipe` with each household: one pull-only household `recipe` change per
 * household, carrying the complete aggregate, and the household's new latest sequence (spec §8.7).
 * Append them to the batch that commits the recipe or the recipe-following meal.
 */
export const sharedRecipeStatements = (
	database: D1Database,
	input: {
		readonly recipe: StoredRecipe;
		readonly householdIds: readonly string[];
		readonly actorUserId: string;
		readonly deviceId: string;
		readonly occurredAt: string;
		readonly receivedAt: string;
	}
): D1PreparedStatement[] => {
	const payload = JSON.stringify({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		payload: { conflictGroups: ['shared'], aggregate: input.recipe }
	});
	const operation = input.recipe.deletedAt === null ? 'upsert' : 'delete';
	return input.householdIds.flatMap((householdId) => {
		const mutationId = uuidv7();
		return [
			database
				.prepare(
					`INSERT INTO sync_changes
					 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
					  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
					  payload, tombstone_expires_at)
					 VALUES (?, ?, ?, 'household', ?, 'recipe', ?, 'shared', ?, ?, ?, ?, ?, NULL)`
				)
				.bind(
					mutationId,
					input.actorUserId,
					input.deviceId,
					householdId,
					input.recipe.id,
					operation,
					Math.max(1, input.recipe.revision),
					input.occurredAt,
					input.receivedAt,
					payload
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
	});
};

/** A bootstrap entry for a recipe the household's recipe-following meals reference. */
const sharedRecipeSnapshot = (recipe: StoredRecipe, sequence: number): HouseholdSyncChange => {
	const clock = Object.values(recipe.conflictClocks)[0];
	return {
		sequence,
		mutationId: uuidv7(),
		originDeviceId: clock?.originDeviceId ?? uuidv7(),
		actorUserId: recipe.ownerUserId,
		entityKind: 'recipe',
		entityId: recipe.id,
		conflictGroups: ['shared'],
		operation: recipe.deletedAt === null ? 'upsert' : 'delete',
		resultingRevision: Math.max(1, recipe.revision),
		occurredAt: recipe.updatedAt,
		receivedAt: recipe.updatedAt,
		aggregate: recipe,
		tombstoneExpiresAt: null
	};
};

const normalizedStatements = (
	database: D1Database,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	aggregate: Record<string, unknown>
): D1PreparedStatement[] => {
	if (entityKind === 'meal') {
		const mealId = String(aggregate.id);
		if ('purgedAt' in aggregate) {
			return [
				database
					.prepare('DELETE FROM meals WHERE id = ? AND household_id = ?')
					.bind(mealId, householdId)
			];
		}
		// A recipe-following row keeps only the meal's own fields; `title` is NOT NULL, so it is empty.
		const following = aggregate.followsRecipe === true;
		const statements = [
			upsert(database, 'meals', {
				...pickSnake(aggregate, MEAL_PARENT_COLUMNS),
				...(following ? { title: '' } : {}),
				follows_recipe: following ? 1 : 0
			})
		];
		statements.push(
			database
				.prepare(
					'DELETE FROM meal_instruction_events WHERE meal_instruction_id IN (SELECT id FROM meal_instructions WHERE meal_id = ?)'
				)
				.bind(mealId),
			database.prepare('DELETE FROM meal_ingredients WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_instructions WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_appliance_requirements WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_classifications WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_media WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_nutrition_facts WHERE meal_id = ?').bind(mealId)
		);
		for (const [property, table, ownerKey] of MEAL_SIDE_CARS) {
			const records = aggregate[property];
			if (!Array.isArray(records)) continue;
			for (const input of records) {
				const source = input as Record<string, unknown>;
				const row = Object.fromEntries(
					Object.entries(source).map(([key, value]) => [camelToSnake(key), sqlValue(value)])
				) as Record<string, SqlValue>;
				if (ownerKey) row[camelToSnake(ownerKey)] = mealId;
				statements.push(upsert(database, table, row));
			}
		}
		return statements;
	}
	if (entityKind === 'meal_check_in') {
		return [
			upsert(database, 'meal_check_ins', {
				...pickSnake(aggregate, CHECK_IN_COLUMNS),
				household_id: householdId
			})
		];
	}
	if (entityKind === 'household') {
		return [
			upsert(database, 'households', pickSnake(aggregate, HOUSEHOLD_TABLE_COLUMNS.household), [
				'household_id'
			])
		];
	}
	const table = HOUSEHOLD_TABLES[entityKind];
	return [upsert(database, table, pickSnake(aggregate, HOUSEHOLD_TABLE_COLUMNS[entityKind]))];
};

const scopeState = async (
	database: D1Database,
	householdId: string
): Promise<HouseholdServerSyncScopeState> => {
	const row = await database
		.prepare(
			`SELECT bootstrap_generation, earliest_retained_sequence, latest_sequence
			 FROM sync_scope_state WHERE audience_kind = 'household' AND audience_id = ?`
		)
		.bind(householdId)
		.first<ScopeRow>();
	return row
		? {
				retainedFloor: row.earliest_retained_sequence,
				latestSequence: row.latest_sequence,
				bootstrapGeneration: row.bootstrap_generation
			}
		: { retainedFloor: 0, latestSequence: 0, bootstrapGeneration: 1 };
};

const readVersions = async (
	database: D1Database,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	entityId: string
): Promise<VersionRow[]> =>
	(
		await database
			.prepare(
				`SELECT conflict_group, revision, last_sequence, winning_occurred_at,
				 winning_origin_device_id, winning_mutation_id, winning_actor_user_id, winning_received_at
				 FROM sync_entity_versions
				 WHERE audience_kind = 'household' AND audience_id = ? AND entity_kind = ? AND entity_id = ?`
			)
			.bind(householdId, entityKind, entityId)
			.all<VersionRow>()
	).results;

const conflictClocks = (versions: readonly VersionRow[]) =>
	Object.fromEntries(
		versions.map((version) => [
			version.conflict_group,
			{
				occurredAt: version.winning_occurred_at,
				originDeviceId: version.winning_origin_device_id,
				mutationId: version.winning_mutation_id
			}
		])
	);

/** Every household entity kind and the normalized table that holds its current row. */
const ENTITY_TABLES = {
	...HOUSEHOLD_TABLES,
	meal: 'meals',
	meal_check_in: 'meal_check_ins'
} as const satisfies Record<HouseholdSyncEntityKind, string>;

export type HouseholdEntityIdentity = EntityIdentity<HouseholdSyncEntityKind>;

const audience = (householdId: string) => ({ kind: 'household' as const, id: householdId });

/**
 * SQL that is true when the household still holds a readable aggregate for the version row `v`.
 * A normalized row or any retained change makes it readable; `?1` must bind the household ID.
 */
const HELD_ENTITY_SQL = `(
	(v.entity_kind = 'household' AND EXISTS (SELECT 1 FROM households WHERE household_id = ?1))
	OR (v.entity_kind <> 'household' AND (
		EXISTS (SELECT 1 FROM sync_changes c WHERE c.audience_kind = 'household' AND c.audience_id = ?1
			AND c.entity_kind = v.entity_kind AND c.entity_id = v.entity_id)
		OR CASE v.entity_kind ${Object.entries(ENTITY_TABLES)
			.filter(([kind]) => kind !== 'household')
			.map(
				([kind, table]) =>
					`WHEN ${kindLiteral(kind)} THEN EXISTS (SELECT 1 FROM ${assertIdentifier(table)} r
						WHERE r.id = v.entity_id AND r.household_id = ?1)`
			)
			.join(' ')} ELSE 0 END
	))
)`;

/**
 * Reads the current snapshot change for each held identity in a fixed number of statements:
 * versions, one row query per kind, the meal sidecars, and fallbacks for rows that are gone.
 * Identities the household does not hold are left out. Results keep the input order.
 */
const readSnapshotChanges = async (
	database: D1Database,
	householdId: string,
	identities: readonly HouseholdEntityIdentity[]
): Promise<HouseholdSyncChange[]> => {
	if (identities.length === 0) return [];
	const idsByKind = groupBy(identities, ({ entityKind }) => entityKind);
	const mealIds = idsByKind.get('meal')?.map(({ entityId }) => entityId) ?? [];
	const [versionRows, rowGroups, sidecars, household] = await Promise.all([
		queryAll<VersionRow & { entity_kind: string; entity_id: string }>(
			database,
			`SELECT entity_kind, entity_id, conflict_group, revision, last_sequence, winning_occurred_at,
			 winning_origin_device_id, winning_mutation_id, winning_actor_user_id, winning_received_at
			 FROM sync_entity_versions
			 WHERE audience_kind = 'household' AND audience_id = ?
			 AND (entity_kind, entity_id) IN (${JSON_IDENTITIES})`,
			householdId,
			identitiesJson(identities)
		),
		Promise.all(
			[...idsByKind.entries()].map(async ([kind, group]) => {
				const table = assertIdentifier(ENTITY_TABLES[kind as HouseholdSyncEntityKind]);
				const rows =
					kind === 'household'
						? await queryAll(database, `SELECT * FROM ${table} WHERE household_id = ?`, householdId)
						: await queryAll(
								database,
								`SELECT * FROM ${table} WHERE household_id = ? AND id IN (${JSON_IDS})`,
								householdId,
								JSON.stringify(group.map(({ entityId }) => entityId))
							);
				return rows.map((row) => ({
					key: householdSyncEntityKey(
						kind as HouseholdSyncEntityKind,
						String(kind === 'household' ? row.household_id : row.id)
					),
					row
				}));
			})
		),
		mealIds.length > 0 ? readSidecars(database, 'meal', mealIds) : new Map(),
		database
			.prepare('SELECT created_by_user_id FROM households WHERE household_id = ?')
			.bind(householdId)
			.first<{ created_by_user_id: string | null }>()
	]);
	const versionsByKey = groupBy(versionRows, (row) =>
		householdSyncEntityKey(row.entity_kind as HouseholdSyncEntityKind, row.entity_id)
	);
	const rowsByKey = new Map(rowGroups.flat().map(({ key, row }) => [key, row]));
	const missing = identities.filter(
		(identity) =>
			identity.entityKind !== 'household' &&
			!rowsByKey.has(householdSyncEntityKey(identity.entityKind, identity.entityId))
	);
	const latestPayloads = new Map(
		missing.length === 0
			? []
			: (
					await queryAll<{
						entity_kind: HouseholdSyncEntityKind;
						entity_id: string;
						payload: string;
					}>(
						database,
						`SELECT entity_kind, entity_id, payload, MAX(seq) AS seq FROM sync_changes
						 WHERE audience_kind = 'household' AND audience_id = ?
						 AND (entity_kind, entity_id) IN (${JSON_IDENTITIES})
						 GROUP BY entity_kind, entity_id`,
						householdId,
						identitiesJson(missing)
					)
				).map((row) => [
					householdSyncEntityKey(row.entity_kind, row.entity_id),
					decodeStoredPayload(row.payload).payload.aggregate
				])
	);

	const changes: HouseholdSyncChange[] = [];
	for (const { entityKind, entityId } of identities) {
		const key = householdSyncEntityKey(entityKind, entityId);
		const versions = versionsByKey.get(key);
		if (!versions) continue;
		const row = rowsByKey.get(key);
		const clocks = conflictClocks(versions);
		let aggregate: unknown;
		if (!row) {
			if (!latestPayloads.has(key)) continue;
			aggregate = latestPayloads.get(key);
		} else if (entityKind === 'household') {
			aggregate = {
				...camelize(row),
				deletionState: 'active',
				localOnly: false,
				conflictClocks: clocks
			};
		} else if (entityKind === 'meal_check_in') {
			aggregate = { ...camelize(row, ['household_id']), conflictClocks: clocks };
		} else if (entityKind === 'meal') {
			aggregate =
				row.follows_recipe === 1
					? followingMealFromRow(row, clocks)
					: {
							...camelize(row, ['follows_recipe']),
							conflictClocks: clocks,
							...sidecars.get(entityId)
						};
		} else {
			const record = camelize(row);
			if (entityKind === 'householdAppliance') record.available = record.available === 1;
			aggregate = { ...record, conflictClocks: clocks };
		}
		changes.push(
			syntheticChange(
				householdId,
				entityKind,
				entityId,
				aggregate,
				versions,
				household?.created_by_user_id ?? null
			)
		);
	}
	return changes;
};

const syntheticChange = (
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	entityId: string,
	aggregate: unknown,
	versions: readonly VersionRow[],
	householdCreatorId: string | null
): HouseholdSyncChange => {
	const winner = versions.toSorted((left, right) => right.last_sequence - left.last_sequence)[0]!;
	const record = aggregate as { deletedAt?: string | null; purgedAt?: string };
	let actorUserId = winner.winning_actor_user_id;
	if (!actorUserId && entityKind === 'meal_check_in') {
		const reporterUserId = (aggregate as { reporterUserId?: unknown }).reporterUserId;
		if (typeof reporterUserId === 'string' && reporterUserId.length > 0)
			actorUserId = reporterUserId;
	}
	actorUserId ??= householdCreatorId ?? `household:${householdId}`;
	return {
		sequence: winner.last_sequence,
		mutationId: winner.winning_mutation_id,
		originDeviceId: winner.winning_origin_device_id,
		actorUserId,
		entityKind,
		entityId,
		conflictGroups: versions.map(({ conflict_group }) => conflict_group) as [string, ...string[]],
		operation: record.deletedAt || record.purgedAt ? 'delete' : 'upsert',
		resultingRevision: Math.max(...versions.map(({ revision }) => revision)),
		occurredAt: winner.winning_occurred_at as `${string}Z`,
		receivedAt: (winner.winning_received_at ?? winner.winning_occurred_at) as `${string}Z`,
		aggregate,
		tombstoneExpiresAt: null
	};
};

const ENTITY_HEAD_SQL = entityHeadSql('household');

type HouseholdCommitInput = Parameters<HouseholdSyncRepository['commit']>[0];

export class D1HouseholdSyncRepository implements HouseholdSyncRepository {
	constructor(private readonly database: D1Database) {}

	readScopeState(householdId: string) {
		return scopeState(this.database, householdId);
	}

	/** Reads the held aggregates for these identities, in input order, at a fixed statement cost. */
	readEntities(householdId: string, identities: readonly HouseholdEntityIdentity[]) {
		return readSnapshotChanges(this.database, householdId, identities);
	}

	/** Reads every held aggregate of these kinds, in entity-key order. */
	async readEntitiesOfKinds(householdId: string, kinds: readonly HouseholdSyncEntityKind[]) {
		const identities = await listHeldIdentities(
			this.database,
			audience(householdId),
			HELD_ENTITY_SQL,
			{ kinds }
		);
		return readSnapshotChanges(this.database, householdId, identities);
	}

	async pull(householdId: string, after: number, limit: number): Promise<HouseholdServerSyncPage> {
		const state = await scopeState(this.database, householdId);
		const rows = (
			await this.database
				.prepare(
					`SELECT * FROM sync_changes
					 WHERE audience_kind = 'household' AND audience_id = ? AND seq > ?
					 ORDER BY seq LIMIT ?`
				)
				.bind(householdId, after, limit + 1)
				.all<ChangeRow>()
		).results;
		const hasMore = rows.length > limit;
		const selected = rows.slice(0, limit);
		return {
			...state,
			changes: selected.map(changeFromRow),
			throughSequence: selected.at(-1)?.seq ?? Math.min(after, state.latestSequence),
			hasMore
		};
	}

	async bootstrap(
		householdId: string,
		page: HouseholdServerBootstrapPageRequest
	): Promise<HouseholdServerBootstrapPage> {
		// Read the watermark before the listing: a commit landing between them then
		// appears on the page instead of being skipped above throughSequence.
		const state = await scopeState(this.database, householdId);
		const identities = await listHeldIdentities<HouseholdSyncEntityKind>(
			this.database,
			audience(householdId),
			HELD_ENTITY_SQL,
			{ afterEntityKey: page.afterEntityKey, limit: page.limit + 1 }
		);
		const authoritativeIds = await heldManifestKeys(
			this.database,
			audience(householdId),
			HELD_ENTITY_SQL,
			page.manifest
		);
		const selected = identities.slice(0, page.limit);
		const last = selected.at(-1);
		const aggregates = await markReinstated(
			this.database,
			audience(householdId),
			await readSnapshotChanges(this.database, householdId, selected)
		);
		// Each page carries the recipes its recipe-following meals show (spec §8.7).
		const followedRecipeIds = aggregates.flatMap(({ entityKind, aggregate }) =>
			entityKind === 'meal' &&
			isLiveMeal(aggregate as StoredMeal) &&
			isRecipeFollowingMeal(aggregate as StoredMeal)
				? [(aggregate as { sourceRecipeId: string }).sourceRecipeId]
				: []
		);
		const sharedRecipes = [
			...(await readCurrentRecipes(this.database, followedRecipeIds)).values()
		].map((recipe) => sharedRecipeSnapshot(recipe, state.latestSequence));
		return {
			...state,
			aggregates: [...sharedRecipes, ...aggregates],
			authoritativeIds,
			nextEntityKey:
				identities.length > page.limit && last
					? householdSyncEntityKey(last.entityKind, last.entityId)
					: null
		};
	}

	private async reject(input: {
		householdId: string;
		mutation: HouseholdSyncMutation;
		receivedAt: string;
		code: string;
	}): Promise<MutationReceipt> {
		const retainUntil = new Date(Date.parse(input.receivedAt) + 365 * 86_400_000).toISOString();
		await this.database
			.prepare(
				`INSERT INTO sync_mutation_receipts
				 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
				  resulting_revision, error_code, created_at, retain_until)
				 VALUES (?, 'household', ?, ?, ?, 'rejected', NULL, NULL, ?, ?, ?)`
			)
			.bind(
				input.mutation.mutationId,
				input.householdId,
				input.mutation.entityKind,
				input.mutation.entityId,
				input.code,
				input.receivedAt,
				retainUntil
			)
			.run();
		return {
			mutationId: input.mutation.mutationId,
			status: 'rejected',
			sequence: null,
			resultingRevision: null,
			errorCode: input.code
		};
	}

	async commit(input: HouseholdCommitInput): Promise<MutationReceipt> {
		return (await this.commitWithResult(input)).receipt;
	}

	/**
	 * Commits one mutation and returns the aggregate it stored. The merge base is read before the
	 * write batch, so the batch only applies while the entity head is unchanged; a concurrent
	 * commit makes it retry against the new head instead of overwriting the other edit.
	 */
	async commitWithResult(input: HouseholdCommitInput): Promise<CommitResult> {
		for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
			const result = await this.attemptCommit(input);
			if (result !== COMMIT_RACED) return result;
		}
		throw new ServerSyncUnavailable({
			code: 'commit_contention',
			message: 'The entity kept changing while this mutation was committed.'
		});
	}

	private async attemptCommit(
		input: HouseholdCommitInput
	): Promise<CommitResult | typeof COMMIT_RACED> {
		const existingReceipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (existingReceipt) {
			const receipt = receiptFromRow(existingReceipt, true);
			// A batch that committed but threw retries here; the write did land, so
			// return the stored aggregate instead of null.
			const aggregate =
				receipt.status === 'accepted' || receipt.status === 'duplicate'
					? ((
							await readSnapshotChanges(this.database, input.householdId, [
								{
									entityKind: input.mutation.entityKind,
									entityId: input.mutation.entityId
								}
							])
						)[0]?.aggregate ?? null)
					: null;
			return { receipt, aggregate };
		}
		const rejected = async (code: string) => ({
			receipt: await this.reject({ ...input, code }),
			aggregate: null
		});

		const decodedIncoming = decodeHouseholdSyncAggregate(
			input.mutation.entityKind,
			input.mutation.entityId,
			input.householdId,
			input.mutation.aggregate
		);
		if (input.mutation.entityKind === 'meal_check_in') {
			const mealId = decodedIncoming.aggregate.mealId;
			if (typeof mealId === 'string') {
				const ownedMeal = await this.database
					.prepare('SELECT 1 AS present FROM meals WHERE id = ? AND household_id = ?')
					.bind(mealId, input.householdId)
					.first<{ present: number }>();
				if (!ownedMeal) return rejected('meal_household_mismatch');
			}
		}
		if (
			input.mutation.entityKind === 'meal' &&
			input.mutation.conflictGroups.includes('schedule')
		) {
			const plannedCookUserId = decodedIncoming.aggregate.plannedCookUserId;
			if (typeof plannedCookUserId === 'string') {
				const currentMember = await this.database
					.prepare(
						`SELECT 1 AS present FROM household_memberships
						 WHERE household_id = ? AND workos_user_id = ? AND status = 'active'`
					)
					.bind(input.householdId, plannedCookUserId)
					.first<{ present: number }>();
				if (!currentMember) return rejected('planned_cook_not_member');
			}
		}
		// Read the head before the tombstone: a deletion committing in between moves the head, so the
		// guarded batch retries and the revival decision sees it.
		const versions = await readVersions(
			this.database,
			input.householdId,
			input.mutation.entityKind,
			input.mutation.entityId
		);
		const activeTombstone = await this.database
			.prepare(
				`SELECT 1 AS present FROM sync_tombstones
				 WHERE audience_kind = 'household' AND audience_id = ? AND entity_kind = ? AND entity_id = ?
				 AND expires_at > ?`
			)
			.bind(input.householdId, input.mutation.entityKind, input.mutation.entityId, input.receivedAt)
			.first<{ present: number }>();
		const stalenessThresholdMinutes =
			(
				await this.database
					.prepare('SELECT staleness_threshold_minutes FROM households WHERE household_id = ?')
					.bind(input.householdId)
					.first<{ staleness_threshold_minutes: number }>()
			)?.staleness_threshold_minutes ?? DEFAULT_STALENESS_THRESHOLD_MINUTES;
		const reinstated = activeTombstone !== null && input.mutation.operation === 'upsert';
		if (
			reinstated &&
			(decodedIncoming.aggregate.deletedAt !== null ||
				!isRecentEdit(input.mutation.occurredAt, input.receivedAt, stalenessThresholdMinutes))
		) {
			return rejected('tombstoned_entity');
		}

		const versionByGroup = new Map(versions.map((version) => [version.conflict_group, version]));
		const winningGroups =
			input.mode === 'live'
				? [...input.mutation.conflictGroups]
				: input.mutation.conflictGroups.filter((group) => {
						const version = versionByGroup.get(group);
						return incomingWinsHistoricalConflict(
							version
								? {
										occurredAt: version.winning_occurred_at,
										originDeviceId: version.winning_origin_device_id,
										mutationId: version.winning_mutation_id
									}
								: null,
							input.mutation,
							stalenessThresholdMinutes
						);
					});
		if (winningGroups.length === 0) {
			return rejected('historical_loser');
		}

		const head = Math.max(0, ...versions.map(({ last_sequence }) => last_sequence));
		const [currentChange] = await readSnapshotChanges(this.database, input.householdId, [
			{ entityKind: input.mutation.entityKind, entityId: input.mutation.entityId }
		]);
		const current = currentChange?.aggregate ?? null;
		const isMeal = input.mutation.entityKind === 'meal';
		const incomingMeal = decodedIncoming.aggregate as StoredMeal;
		// A copy only applies while D1 still holds the meal as recipe-following. Another device
		// copied it first; the edits that came with this copy are separate mutations (spec §5.3).
		if (
			isMeal &&
			input.mode === 'live' &&
			isCopyOnly(winningGroups) &&
			current !== null &&
			isLiveMeal(current as StoredMeal) &&
			!isRecipeFollowingMeal(current as StoredMeal) &&
			isLiveMeal(incomingMeal) &&
			!isRecipeFollowingMeal(incomingMeal)
		) {
			return rejected(MEAL_ALREADY_COPIED);
		}
		// A copy writes every content group, whichever of them a later local edit now owns.
		const acceptedGroups =
			isMeal && copiesMeal(current, incomingMeal, winningGroups)
				? [...new Set([...winningGroups, ...MEAL_COPY_GROUPS])]
				: winningGroups;
		const revision = Math.max(0, ...versions.map(({ revision }) => revision)) + 1;
		const clock = {
			occurredAt: input.mutation.occurredAt,
			originDeviceId: input.mutation.originDeviceId,
			mutationId: input.mutation.mutationId
		};
		const tombstoneExpiresAt =
			input.mutation.operation === 'delete'
				? new Date(Date.parse(input.receivedAt) + 365 * 86_400_000).toISOString()
				: null;
		const result =
			input.mutation.operation === 'delete' && input.mutation.entityKind === 'meal'
				? {
						schemaVersion: CURRENT_SCHEMA_VERSION,
						revision,
						createdAt: decodedIncoming.aggregate.createdAt,
						updatedAt: input.mutation.occurredAt,
						deletedAt: input.mutation.occurredAt,
						conflictClocks: { deletion: clock },
						id: input.mutation.entityId,
						householdId: input.householdId,
						purgedAt: input.receivedAt,
						retainUntil: tombstoneExpiresAt!
					}
				: input.mutation.entityKind === 'meal'
					? mergeMeal(current, decodedIncoming.aggregate, acceptedGroups, revision, clock)
					: {
							...decodedIncoming.aggregate,
							revision,
							updatedAt: input.mutation.occurredAt,
							conflictClocks: {
								...((current as { conflictClocks?: Record<string, unknown> } | null)
									?.conflictClocks ?? {}),
								...Object.fromEntries(acceptedGroups.map((group) => [group, clock]))
							}
						};
		// Purging a source recipe nulls meal provenance (§5.3). An offline or revived aggregate written
		// after that still names the recipe, so it gets the same null instead of failing the foreign key.
		const sourceRecipeId = (result as { sourceRecipeId?: unknown }).sourceRecipeId;
		const sourceRecipe =
			typeof sourceRecipeId === 'string'
				? await this.database
						.prepare('SELECT owner_user_id FROM recipes WHERE id = ?')
						.bind(sourceRecipeId)
						.first<{ owner_user_id: string }>()
				: null;
		const sourceRecipePurged = typeof sourceRecipeId === 'string' && sourceRecipe === null;
		const follows =
			isMeal && isLiveMeal(result as StoredMeal) && isRecipeFollowingMeal(result as StoredMeal);
		// A recipe-following meal has nothing to show without its recipe, so its provenance cannot
		// simply be dropped (§8.7). A purged recipe ends the meal; one not uploaded yet makes the
		// device retry after its recipe sync.
		if (sourceRecipePurged && follows) {
			const purged = await this.database
				.prepare(
					`SELECT 1 AS present FROM sync_tombstones
					 WHERE audience_kind = 'user' AND entity_kind = 'recipe' AND entity_id = ?`
				)
				.bind(sourceRecipeId)
				.first();
			if (purged) return rejected('tombstoned_entity');
			throw new ServerSyncUnavailable({
				code: 'source_recipe_pending',
				message: 'The recipe this meal follows has not been uploaded yet.'
			});
		}
		// Following shares the recipe, so only its owner may start it, or a member of a household
		// that already receives the recipe (§8.7). Knowing a recipe's ID reveals none of its content.
		if (
			follows &&
			sourceRecipe !== null &&
			sourceRecipe.owner_user_id !== input.actorUserId &&
			!(await this.householdFollows(input.householdId, sourceRecipeId as string))
		) {
			return rejected(RECIPE_NOT_SHARED);
		}
		// Planning a recipe-following meal shares its recipe with the household (spec §8.7). The
		// batch commits only while the recipe is unchanged, so the household never keeps an old one.
		const sharesRecipe = follows && acceptedGroups.includes('source');
		const guards = sharesRecipe
			? [await readCommitGuard(this.database, RECIPE_HEAD_SQL, sourceRecipeId as string)]
			: [];
		const sharedRecipe = sharesRecipe
			? (await readCurrentRecipes(this.database, [sourceRecipeId as string])).get(
					sourceRecipeId as string
				)
			: undefined;
		const guardSql = commitGuardSql(guards);
		const decodedResult = decodeHouseholdSyncAggregate(
			input.mutation.entityKind,
			input.mutation.entityId,
			input.householdId,
			sourceRecipePurged ? { ...(result as object), sourceRecipeId: null } : result
		);
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			payload: {
				conflictGroups: acceptedGroups,
				aggregate: decodedResult.aggregate,
				...(reinstated ? { reinstated: true } : {})
			}
		});
		const receiptRetainUntil = new Date(
			Date.parse(input.receivedAt) + 365 * 86_400_000
		).toISOString();
		const statements = [
			this.database
				.prepare(
					`INSERT INTO users (workos_user_id, schema_version, revision, created_at, updated_at)
					 VALUES (?, 1, 1, ?, ?) ON CONFLICT(workos_user_id) DO NOTHING`
				)
				.bind(input.actorUserId, input.receivedAt, input.receivedAt),
			...normalizedStatements(
				this.database,
				input.householdId,
				input.mutation.entityKind,
				decodedResult.aggregate
			),
			this.database
				.prepare(
					`INSERT INTO sync_changes
					 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
					  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
					  payload, tombstone_expires_at)
					 VALUES (?, ?, ?, 'household', ?, ?, ?, ?, ?, ?, ?, ?,
					  CASE WHEN ${ENTITY_HEAD_SQL} = ?${guardSql.sql} THEN ? END, ?)`
				)
				.bind(
					input.mutation.mutationId,
					input.actorUserId,
					input.mutation.originDeviceId,
					input.householdId,
					input.mutation.entityKind,
					input.mutation.entityId,
					acceptedGroups.join(','),
					input.mutation.operation,
					revision,
					input.mutation.occurredAt,
					input.receivedAt,
					// A moved head leaves the payload NULL, which fails NOT NULL and rolls the batch back.
					input.householdId,
					input.mutation.entityKind,
					input.mutation.entityId,
					head,
					...guardSql.binds,
					payload,
					tombstoneExpiresAt
				)
		];
		for (const group of acceptedGroups) {
			statements.push(
				this.database
					.prepare(
						`INSERT INTO sync_entity_versions
						 (audience_kind, audience_id, entity_kind, entity_id, conflict_group, revision,
						  last_sequence, winning_occurred_at, winning_origin_device_id, winning_mutation_id,
						  winning_actor_user_id, winning_received_at)
						 VALUES ('household', ?, ?, ?, ?, ?,
						  (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, ?, ?, ?, ?)
						 ON CONFLICT(audience_kind, audience_id, entity_kind, entity_id, conflict_group)
						 DO UPDATE SET revision = excluded.revision, last_sequence = excluded.last_sequence,
						  winning_occurred_at = excluded.winning_occurred_at,
						  winning_origin_device_id = excluded.winning_origin_device_id,
						  winning_mutation_id = excluded.winning_mutation_id,
						  winning_actor_user_id = excluded.winning_actor_user_id,
						  winning_received_at = excluded.winning_received_at`
					)
					.bind(
						input.householdId,
						input.mutation.entityKind,
						input.mutation.entityId,
						group,
						revision,
						input.mutation.mutationId,
						input.mutation.occurredAt,
						input.mutation.originDeviceId,
						input.mutation.mutationId,
						input.actorUserId,
						input.receivedAt
					)
			);
		}
		statements.push(
			this.database
				.prepare(
					`INSERT INTO sync_scope_state
					 (audience_kind, audience_id, bootstrap_generation, earliest_retained_sequence,
					  latest_sequence, updated_at)
					 VALUES ('household', ?, 1, 0, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?)
					 ON CONFLICT(audience_kind, audience_id) DO UPDATE SET
					  latest_sequence = excluded.latest_sequence, updated_at = excluded.updated_at`
				)
				.bind(input.householdId, input.mutation.mutationId, input.receivedAt),
			this.database
				.prepare(
					`INSERT INTO sync_devices
					 (device_id, workos_user_id, created_at, last_seen_at, last_app_version, last_protocol_version)
					 VALUES (?, ?, ?, ?, 'v1', 1)
					 ON CONFLICT(device_id, workos_user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
					  last_app_version = excluded.last_app_version,
					  last_protocol_version = excluded.last_protocol_version`
				)
				.bind(input.deviceId, input.actorUserId, input.receivedAt, input.receivedAt),
			this.database
				.prepare(
					`INSERT INTO sync_mutation_receipts
					 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
					  resulting_revision, error_code, created_at, retain_until)
					 VALUES (?, 'household', ?, ?, ?, 'accepted',
					  (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, NULL, ?, ?)`
				)
				.bind(
					input.mutation.mutationId,
					input.householdId,
					input.mutation.entityKind,
					input.mutation.entityId,
					input.mutation.mutationId,
					revision,
					input.receivedAt,
					receiptRetainUntil
				)
		);
		if (tombstoneExpiresAt) {
			statements.push(
				this.database
					.prepare(
						`INSERT INTO sync_tombstones
						 (audience_kind, audience_id, entity_kind, entity_id, deletion_sequence, deleted_at,
						  expires_at, previous_server_ack)
						 VALUES ('household', ?, ?, ?, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, ?, 1)
						 ON CONFLICT(audience_kind, audience_id, entity_kind, entity_id) DO UPDATE SET
						  deletion_sequence = excluded.deletion_sequence, deleted_at = excluded.deleted_at,
						  expires_at = excluded.expires_at, previous_server_ack = 1`
					)
					.bind(
						input.householdId,
						input.mutation.entityKind,
						input.mutation.entityId,
						input.mutation.mutationId,
						input.mutation.occurredAt,
						tombstoneExpiresAt
					)
			);
		} else {
			statements.push(
				this.database
					.prepare(
						`DELETE FROM sync_tombstones WHERE audience_kind = 'household' AND audience_id = ?
						 AND entity_kind = ? AND entity_id = ?`
					)
					.bind(input.householdId, input.mutation.entityKind, input.mutation.entityId)
			);
		}
		if (sharedRecipe) {
			statements.push(
				...sharedRecipeStatements(this.database, {
					recipe: sharedRecipe,
					householdIds: [input.householdId],
					actorUserId: input.actorUserId,
					deviceId: input.deviceId,
					occurredAt: input.mutation.occurredAt,
					receivedAt: input.receivedAt
				})
			);
		}
		try {
			await this.database.batch(statements);
		} catch (error) {
			if (await this.raced(input, head, guards)) return COMMIT_RACED;
			throw error;
		}
		const receipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (!receipt) throw new TypeError('The committed mutation has no receipt.');
		return { receipt: receiptFromRow(receipt), aggregate: decodedResult.aggregate };
	}

	/** True when another commit moved the entity head or a guard, or stored this mutation first. */
	private async raced(
		input: HouseholdCommitInput,
		head: number,
		guards: readonly CommitGuard[]
	): Promise<boolean> {
		const guardSql = commitGuardSql(guards);
		const row = await this.database
			.prepare(
				`SELECT ${ENTITY_HEAD_SQL} AS head,
				 EXISTS (SELECT 1 FROM sync_mutation_receipts WHERE mutation_id = ?) AS stored,
				 (1${guardSql.sql}) AS guarded`
			)
			.bind(
				input.householdId,
				input.mutation.entityKind,
				input.mutation.entityId,
				input.mutation.mutationId,
				...guardSql.binds
			)
			.first<{ head: number; stored: number; guarded: number }>();
		return row !== null && (row.head !== head || row.stored === 1 || row.guarded === 0);
	}

	/** True when a live recipe-following meal in the household follows the recipe. */
	private async householdFollows(householdId: string, recipeId: string): Promise<boolean> {
		const row = await this.database
			.prepare(
				`SELECT 1 AS present FROM meals WHERE household_id = ? AND source_recipe_id = ?
				 AND follows_recipe = 1 AND deleted_at IS NULL LIMIT 1`
			)
			.bind(householdId, recipeId)
			.first();
		return row !== null;
	}

	/**
	 * Copies `recipe`, the version before a change, into the recipe-following meals that must not see
	 * the change (spec §5.3): all of them when the recipe is deleted; on an edit, those cooked,
	 * skipped, or dated before today in their household, and those in households the owner left.
	 * Each copy is a live household meal mutation, so a device that copied first wins quietly.
	 */
	async copyFollowingMealsBeforeRecipeChange(input: {
		readonly recipe: RecipeAggregate;
		readonly change: 'edit' | 'delete';
		readonly deviceId: string;
		readonly occurredAt: string;
		readonly receivedAt: string;
	}): Promise<void> {
		const occurredAt = Schema.decodeUnknownSync(UtcInstantSchema)(input.occurredAt);
		const rows = await queryAll<{
			id: string;
			household_id: string;
			timezone: string | null;
			owner_member: number;
		}>(
			this.database,
			`SELECT m.id, m.household_id, h.timezone,
			 EXISTS (SELECT 1 FROM household_memberships hm WHERE hm.household_id = m.household_id
			  AND hm.workos_user_id = ? AND hm.status = 'active') AS owner_member
			 FROM meals m JOIN households h ON h.household_id = m.household_id
			 WHERE m.source_recipe_id = ? AND m.follows_recipe = 1 AND m.deleted_at IS NULL`,
			input.recipe.ownerUserId,
			input.recipe.id
		);
		const now = new Date(input.receivedAt);
		for (const [householdId, group] of groupBy(rows, ({ household_id }) => household_id)) {
			const changes = await readSnapshotChanges(
				this.database,
				householdId,
				group.map(({ id }) => ({ entityKind: 'meal' as const, entityId: id }))
			);
			const today = householdToday(now, group[0]!.timezone);
			const ownerMember = group[0]!.owner_member === 1;
			for (const { aggregate } of changes) {
				const meal = Schema.decodeUnknownSync(RecipeFollowingMealSchema)(aggregate);
				const copies =
					input.change === 'delete' || !ownerMember || freezesBeforeRecipeChange(meal, today);
				if (!copies) continue;
				await this.commitWithResult({
					householdId,
					actorUserId: input.recipe.ownerUserId,
					deviceId: input.deviceId,
					mutation: {
						schemaVersion: CURRENT_SCHEMA_VERSION,
						mutationId: uuidv7(),
						originDeviceId: input.deviceId,
						entityKind: 'meal',
						entityId: meal.id,
						conflictGroups: [...MEAL_COPY_GROUPS],
						operation: 'upsert',
						occurredAt,
						aggregate: copyRecipeIntoMeal(meal, input.recipe)
					},
					mode: 'live',
					receivedAt: input.receivedAt
				});
			}
		}
	}

	async prune(input: { now: string; changeCutoff: string }): Promise<void> {
		await pruneSyncRetentionBatch(this.database, {
			audienceKind: 'household',
			...input
		});
	}
}
