import { uuidv7 } from 'uuidv7';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { VERSION_RETENTION_MS, collectableVersions } from '$lib/domain/meals/recipe-following.js';
import type { RecipeVersion } from '$lib/domain/recipes/versions.js';
import { queryAll, readCommitGuard } from '$lib/server/sync/d1-snapshot.js';
import {
	LATEST_SEQUENCE_SQL,
	followingMealsOf,
	loadMealResolution,
	readRecipeVersions,
	sharedVersionStatements
} from '$lib/server/sync/recipe-versions.js';

/** How many recipes one maintenance run examines at most. */
export const VERSION_COLLECTION_BATCH = 50;

/**
 * 1 while nothing that decides what a recipe's versions are needed for changed after the sequence
 * read before collection: no recipe-following meal of the recipe bound to `recipe`, no check-in on
 * one, and no version of the recipe was written after the sequence bound to `since`.
 */
const unchangedSinceSql = (
	recipe: string,
	since: string
): string => `(NOT EXISTS (SELECT 1 FROM meals m
	 JOIN sync_entity_versions v ON v.audience_kind = 'household' AND v.audience_id = m.household_id
	  AND v.entity_kind = 'meal' AND v.entity_id = m.id
	 WHERE m.followed_recipe_id = ${recipe} AND v.last_sequence > ${since})
	AND NOT EXISTS (SELECT 1 FROM meal_check_ins c JOIN meals m ON m.id = c.meal_id
	 JOIN sync_entity_versions v ON v.audience_kind = 'household' AND v.audience_id = c.household_id
	  AND v.entity_kind = 'meal_check_in' AND v.entity_id = c.id
	 WHERE m.followed_recipe_id = ${recipe} AND v.last_sequence > ${since})
	AND NOT EXISTS (SELECT 1 FROM sync_entity_versions v JOIN recipe_versions r ON r.id = v.entity_id
	 WHERE v.audience_kind = 'user' AND v.entity_kind = 'recipeVersion' AND r.recipe_id = ${recipe}
	  AND v.last_sequence > ${since}))`;

/**
 * Collects the recipe versions no meal or check-in needs (spec §5.2). For each recipe it reads the
 * versions, the recipe-following meals, and their check-ins, then deletes what the rule collects in
 * one batch that commits only while none of them changed since the read. Each deletion reaches the
 * owner's user audience and every household following the recipe. Returns how many it collected.
 */
export const collectRecipeVersions = async (
	database: D1Database,
	now: string,
	limit = VERSION_COLLECTION_BATCH
): Promise<number> => {
	const horizon = new Date(Date.parse(now) - VERSION_RETENTION_MS).toISOString();
	// Recipes with a version old enough to collect: superseded before the horizon, or of a recipe
	// that no longer exists. The rule decides which of their versions actually go.
	const candidates = await queryAll<{ recipe_id: string }>(
		database,
		`SELECT DISTINCT v.recipe_id FROM recipe_versions v WHERE v.effective_at < ?1
		 AND (NOT EXISTS (SELECT 1 FROM recipes r WHERE r.id = v.recipe_id)
		  OR EXISTS (SELECT 1 FROM recipe_versions n WHERE n.recipe_id = v.recipe_id
		   AND n.id <> v.id AND n.effective_at >= v.effective_at AND n.effective_at < ?1))
		 ORDER BY random() LIMIT ?2`,
		horizon,
		limit
	);
	let collected = 0;
	for (const { recipe_id: recipeId } of candidates) {
		collected += await collectRecipe(database, recipeId, now);
	}
	return collected;
};

const collectRecipe = async (
	database: D1Database,
	recipeId: string,
	now: string
): Promise<number> => {
	const since = await readCommitGuard(database, LATEST_SEQUENCE_SQL);
	const [versions, meals, recipe] = await Promise.all([
		readRecipeVersions(database, [recipeId]),
		followingMealsOf(database, recipeId),
		database.prepare('SELECT 1 AS present FROM recipes WHERE id = ?').bind(recipeId).first()
	]);
	const garbage = collectableVersions({
		versions,
		meals,
		contextOf: await loadMealResolution(database, meals),
		recipeExists: recipe !== null,
		now: new Date(now)
	});
	if (garbage.length === 0) return 0;
	const statements = deletionStatements(database, {
		garbage: garbage.map((version) => ({ ...version, deletedAt: now as `${string}Z` })),
		householdIds: [...new Set(meals.map(({ householdId }) => householdId))],
		guard: { recipeId, since: since.value },
		now
	});
	try {
		await database.batch(statements);
	} catch (error) {
		const unchanged = await database
			.prepare(`SELECT ${unchangedSinceSql('?1', '?2')} AS unchanged`)
			.bind(recipeId, since.value)
			.first<{ unchanged: number }>();
		// Something the rule depends on changed meanwhile; the next run decides again.
		if (unchanged?.unchanged === 0) return 0;
		throw error;
	}
	return garbage.length;
};

/**
 * The batch that deletes collected versions and syncs each deletion. Its first insert leaves its
 * payload NULL, which fails NOT NULL and rolls the batch back, unless the guard still holds.
 */
const deletionStatements = (
	database: D1Database,
	input: {
		readonly garbage: readonly RecipeVersion[];
		readonly householdIds: readonly string[];
		readonly guard: { readonly recipeId: string; readonly since: number };
		readonly now: string;
	}
): D1PreparedStatement[] =>
	input.garbage.flatMap((version, index) => {
		const mutationId = uuidv7();
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			payload: { conflictGroups: ['row'], aggregate: version }
		});
		const guarded = index === 0;
		return [
			database
				.prepare(
					`INSERT INTO sync_changes
					 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
					  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
					  payload, tombstone_expires_at)
					 VALUES (?1, ?2, ?3, 'user', ?2, 'recipeVersion', ?4, 'row', 'delete', 1, ?5, ?5,
					  ${guarded ? `CASE WHEN ${unchangedSinceSql('?7', '?8')} THEN ?6 END` : '?6'},
					  NULL)`
				)
				.bind(
					mutationId,
					version.ownerUserId,
					uuidv7(),
					version.id,
					input.now,
					payload,
					...(guarded ? [input.guard.recipeId, input.guard.since] : [])
				),
			database
				.prepare(
					`INSERT INTO sync_scope_state
					 (audience_kind, audience_id, bootstrap_generation, earliest_retained_sequence,
					  latest_sequence, updated_at)
					 VALUES ('user', ?, 1, 0, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?)
					 ON CONFLICT(audience_kind, audience_id) DO UPDATE SET
					  latest_sequence = excluded.latest_sequence, updated_at = excluded.updated_at`
				)
				.bind(version.ownerUserId, mutationId, input.now),
			database.prepare('DELETE FROM recipe_versions WHERE id = ?').bind(version.id),
			database
				.prepare(
					`DELETE FROM sync_entity_versions WHERE audience_kind = 'user'
					 AND entity_kind = 'recipeVersion' AND entity_id = ?`
				)
				.bind(version.id),
			...sharedVersionStatements(database, {
				versions: [version],
				householdIds: input.householdIds,
				actorUserId: version.ownerUserId,
				deviceId: uuidv7(),
				occurredAt: input.now,
				receivedAt: input.now
			})
		];
	});
