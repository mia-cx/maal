import { liveQuery } from 'dexie';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { listHouseholdsForProfile } from '$lib/client/local/households.js';
import { activeHouseholdKey, readActiveProfile } from '$lib/client/local/profiles.js';
import { listHouseholdMeals, listMealCheckIns } from '$lib/client/meals/queries.js';
import type { MealAggregate, MealCheckIn, MealVerdict } from '$lib/domain/meals/schema.js';
import { emptyRecipeStats, type RecipeMenuStats } from '$lib/menu/recipe-defaults.js';

const reviewCounter = {
	repeat: 'worthRepeating',
	neutral: 'neutral',
	avoid: 'neverAgain'
} as const satisfies Record<MealVerdict, keyof RecipeMenuStats['reviewSummary']>;

/** The active profile's active household, or null when that profile cannot see it. */
const readAccessibleActiveHouseholdId = async (database: MaalDatabase): Promise<string | null> => {
	const profile = await readActiveProfile(database);
	if (!profile) return null;
	const householdId = (await database.uiState.get(activeHouseholdKey(profile.profileId)))?.value;
	if (typeof householdId !== 'string') return null;
	const households = await listHouseholdsForProfile(database, profile.profileId);
	return households.some(({ household }) => household.householdId === householdId)
		? householdId
		: null;
};

/**
 * One pass over linked meals, then one over their check-ins, matching the prototype's
 * `loadMenuRecipes`: every linked meal counts as planned, `cooked` meals count as cooked, and
 * check-ins from every household member feed the review summary, verdict, and actual time.
 */
const deriveRecipeStatistics = (
	meals: readonly MealAggregate[],
	checkIns: readonly MealCheckIn[]
): Map<string, RecipeMenuStats> => {
	const statsByRecipeId = new Map<string, RecipeMenuStats>();
	const recipeIdByMealId = new Map<string, string>();
	for (const meal of meals) {
		if (meal.sourceRecipeId === null) continue;
		recipeIdByMealId.set(meal.id, meal.sourceRecipeId);
		let stats = statsByRecipeId.get(meal.sourceRecipeId);
		if (!stats) {
			stats = emptyRecipeStats();
			statsByRecipeId.set(meal.sourceRecipeId, stats);
		}
		stats.plannedCount += 1;
		if (meal.status !== 'cooked') continue;
		stats.timesCooked += 1;
		// Undated meals use the status clock: `updatedAt` also moves on unrelated edits.
		const cookedOn = meal.date ?? meal.conflictClocks.status?.occurredAt ?? meal.updatedAt;
		if (!stats.lastCookedAt || cookedOn > stats.lastCookedAt) stats.lastCookedAt = cookedOn;
	}

	const actualMinutes = new Map<string, { total: number; count: number }>();
	const chronological = checkIns.toSorted(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
	);
	for (const checkIn of chronological) {
		const recipeId = checkIn.mealId === null ? undefined : recipeIdByMealId.get(checkIn.mealId);
		if (!recipeId) continue;
		const stats = statsByRecipeId.get(recipeId)!;
		stats.reviewSummary[reviewCounter[checkIn.verdict]] += 1;
		if (checkIn.reason) stats.reviewSummary.notes.push(checkIn.reason);
		stats.latestVerdict = checkIn.verdict;
		if (checkIn.cookTimeMinutes === null) continue;
		const minutes = actualMinutes.get(recipeId) ?? { total: 0, count: 0 };
		minutes.total += checkIn.cookTimeMinutes;
		minutes.count += 1;
		actualMinutes.set(recipeId, minutes);
	}
	for (const [recipeId, { total, count }] of actualMinutes) {
		statsByRecipeId.get(recipeId)!.averageActualMinutes = total / count;
	}
	return statsByRecipeId;
};

/**
 * Menu statistics by recipe ID for the active profile's active household. Deleted meals and
 * check-ins never count; an inaccessible or unset household yields an empty map.
 */
export const readRecipeStatistics = async (
	database: MaalDatabase
): Promise<ReadonlyMap<string, RecipeMenuStats>> => {
	const householdId = await readAccessibleActiveHouseholdId(database);
	if (!householdId) return new Map();
	const linkedMeals = (await listHouseholdMeals(database, householdId)).filter(
		({ sourceRecipeId }) => sourceRecipeId !== null
	);
	const checkIns = await listMealCheckIns(database, new Set(linkedMeals.map(({ id }) => id)));
	return deriveRecipeStatistics(linkedMeals, checkIns);
};

/**
 * `readRecipeStatistics` as a Dexie live query: re-emits on meal, check-in, profile, household,
 * and membership changes.
 */
export const liveRecipeStatistics = (database: MaalDatabase) =>
	// Keep the querier `async`: Dexie only tracks reads after the first `await` for async functions.
	liveQuery(async () => readRecipeStatistics(database));
