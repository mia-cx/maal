import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { loadMealResolution } from '$lib/client/meals/resolution.js';
import { collectableVersions } from '$lib/domain/meals/recipe-following.js';
import {
	StoredMealSchema,
	isRecipeFollowingMeal,
	type RecipeFollowingMeal
} from '$lib/domain/meals/schema.js';
import { StoredRecipeSchema, isRecipeAggregate } from '$lib/domain/recipes/schema.js';
import { RecipeVersionSchema, type RecipeVersion } from '$lib/domain/recipes/versions.js';

/**
 * The device's side of version collection (spec §5.2). The Worker collects every synced version,
 * and its deletions reach the device through sync, so the device collects only:
 *
 * - versions of a local profile whose user scope has never synced, by the same rule as the Worker;
 * - versions of another owner's recipe that no live meal on this device follows any more.
 *
 * A collected version's unsent outbox rows go with it. Returns the IDs it removed.
 */
export const runRecipeVersionRetention = async (
	database: MaalDatabase,
	now = new Date()
): Promise<string[]> =>
	database.transaction(
		'rw',
		[
			database.recipeVersions,
			database.recipes,
			database.meals,
			database.mealCheckIns,
			database.households,
			database.memberships,
			database.profiles,
			database.syncScopes,
			database.outbox
		],
		async () => {
			const versions = (await database.recipeVersions.toArray()).map((row) =>
				Schema.decodeUnknownSync(RecipeVersionSchema)(row)
			);
			const localOwners = new Set(
				(await database.profiles.toArray()).map(({ workosUserId }) => workosUserId)
			);
			const syncedOwners = new Set(
				(await database.syncScopes.toArray())
					.filter(({ scopeKind, cursor }) => scopeKind === 'user' && cursor !== null)
					.map(({ scopeId }) => scopeId)
			);
			const removed: string[] = [];
			for (const [recipeId, recipeVersions] of Map.groupBy(
				versions,
				(version) => version.recipeId
			)) {
				const owner = recipeVersions[0]!.ownerUserId;
				if (localOwners.has(owner) && syncedOwners.has(owner)) continue;
				const meals = (await database.meals.where('sourceRecipeId').equals(recipeId).toArray())
					.map((row) => Schema.decodeUnknownSync(StoredMealSchema)(row))
					.filter(
						(meal): meal is RecipeFollowingMeal =>
							isRecipeFollowingMeal(meal) && meal.deletedAt === null
					);
				const garbage: RecipeVersion[] = localOwners.has(owner)
					? await collectLocal(database, recipeId, recipeVersions, meals, now)
					: meals.length === 0
						? recipeVersions
						: [];
				const ids = garbage.map(({ id }) => id);
				await database.recipeVersions.bulkDelete(ids);
				await database.outbox
					.where('aggregateId')
					.anyOf(ids)
					.filter(
						({ entityKind, status }) => entityKind === 'recipeVersion' && status !== 'acknowledged'
					)
					.delete();
				removed.push(...ids);
			}
			return removed;
		}
	);

const collectLocal = async (
	database: MaalDatabase,
	recipeId: string,
	versions: readonly RecipeVersion[],
	meals: readonly RecipeFollowingMeal[],
	now: Date
): Promise<RecipeVersion[]> => {
	const stored = await database.recipes.get(recipeId);
	return collectableVersions({
		versions,
		meals,
		contextOf: await loadMealResolution(database, meals),
		recipeExists:
			stored !== undefined &&
			isRecipeAggregate(Schema.decodeUnknownSync(StoredRecipeSchema)(stored)),
		now
	});
};
