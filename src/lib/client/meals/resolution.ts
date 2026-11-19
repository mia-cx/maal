import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { readRecipeVersions } from '$lib/client/recipes/versions.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import {
	resolveMeal,
	resolveMealVersion,
	type MealResolutionContext
} from '$lib/domain/meals/recipe-following.js';
import {
	MealCheckInSchema,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealAggregate,
	type MealCheckIn,
	type RecipeFollowingMeal
} from '$lib/domain/meals/schema.js';
import type { ContentVersion } from '$lib/domain/recipes/versions.js';

const decodeCheckIn = (row: unknown): MealCheckIn => {
	try {
		return Schema.decodeUnknownSync(MealCheckInSchema)(row);
	} catch {
		throw new LocalDecodeError({
			operation: 'decode meal check-in',
			message: 'A local check-in did not match its contract.'
		});
	}
};

/**
 * Reads what these meals resolve against on this device: their recipes' versions, their check-ins,
 * and their households' timezones (spec §5.3). Inside a live query, the reads make the query re-run
 * when a version arrives, a check-in pins one, or a timezone changes.
 */
export const loadMealResolution = async (
	database: MaalDatabase,
	meals: readonly LiveMeal[]
): Promise<(meal: RecipeFollowingMeal) => MealResolutionContext> => {
	const following = meals.filter(isRecipeFollowingMeal);
	if (following.length === 0) return () => ({ versions: [], checkIns: [], timeZone: null });
	const householdIds = [...new Set(following.map(({ householdId }) => householdId))];
	const [versions, checkInRows, households, memberships] = await Promise.all([
		readRecipeVersions(
			database,
			following.map(({ sourceRecipeId }) => sourceRecipeId)
		),
		database.mealCheckIns
			.where('mealId')
			.anyOf(following.map(({ id }) => id))
			.toArray(),
		database.households.bulkGet(householdIds),
		database.memberships.where('householdId').anyOf(householdIds).toArray()
	]);
	// A detached snapshot never changes with its recipes: it resolves only among the versions that
	// took effect before it was detached (spec §4.3).
	const detachedAt = new Map(
		[...Map.groupBy(memberships, ({ householdId }) => householdId)].flatMap(([id, rows]) =>
			rows.some(({ status }) => status === 'active')
				? []
				: rows.flatMap(({ detachedAt }) => (detachedAt === null ? [] : [[id, detachedAt] as const]))
		)
	);
	const versionsByRecipe = Map.groupBy(versions, ({ recipeId }) => recipeId);
	const checkInsByMeal = Map.groupBy(checkInRows.map(decodeCheckIn), ({ mealId }) => mealId);
	const timeZones = new Map(
		householdIds.map((id, index) => [id, households[index]?.timezone ?? null] as const)
	);
	return (meal) => ({
		versions: (versionsByRecipe.get(meal.sourceRecipeId) ?? []).filter(({ effectiveAt }) => {
			const cutoff = detachedAt.get(meal.householdId);
			return cutoff === undefined || effectiveAt < cutoff;
		}),
		checkIns: checkInsByMeal.get(meal.id) ?? [],
		timeZone: timeZones.get(meal.householdId) ?? null
	});
};

/** Live meals as readers show them; a meal whose version is not here yet is left out. */
export const resolveLocalMeals = async (
	database: MaalDatabase,
	meals: readonly LiveMeal[]
): Promise<MealAggregate[]> => {
	const contextOf = await loadMealResolution(database, meals);
	return meals.flatMap((meal) => {
		const resolved = resolveMeal(
			meal,
			isRecipeFollowingMeal(meal) ? contextOf(meal) : { versions: [], checkIns: [], timeZone: null }
		);
		return resolved === null ? [] : [resolved];
	});
};

/** The version a recipe-following meal resolves to on this device, or null while it is missing. */
export const resolveLocalMealVersion = async (
	database: MaalDatabase,
	meal: RecipeFollowingMeal
): Promise<ContentVersion | null> =>
	resolveMealVersion(meal, (await loadMealResolution(database, [meal]))(meal));
