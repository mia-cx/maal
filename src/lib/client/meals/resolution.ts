import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import type { HouseholdVersionRecord } from '$lib/client/local/records.js';
import { readRecipeVersions } from '$lib/client/recipes/versions.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import type { Membership } from '$lib/domain/household/contracts.js';
import {
	householdSeesVersion,
	ownerStanding,
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
import type { ContentVersion, RecipeVersion } from '$lib/domain/recipes/versions.js';

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

/** What decides which of an owner's versions each household sees on this device (spec §8.7). */
export interface DeviceVersionVisibility {
	readonly memberships: readonly Membership[];
	readonly householdVersions: readonly HouseholdVersionRecord[];
}

/**
 * Whether a household sees a version on this device, by {@link householdSeesVersion}. The owner's
 * standing comes from their membership rows in the household; a membership that is not active ended
 * when it was detached or last updated. A household every profile here left is a detached snapshot:
 * its view ends at the detachment, as though every owner left then. An owner with no membership row
 * here is one the Worker applied the rule for, so the household sees the versions its sync delivered.
 */
export const deviceVersionVisibility = ({
	memberships,
	householdVersions
}: DeviceVersionVisibility): ((householdId: string, version: RecipeVersion) => boolean) => {
	const byHousehold = Map.groupBy(memberships, ({ householdId }) => householdId);
	const snapshotEnds = new Map(
		[...byHousehold].flatMap(([householdId, rows]) =>
			rows.some(({ status }) => status === 'active')
				? []
				: rows.flatMap(({ detachedAt }) =>
						detachedAt === null ? [] : [[householdId, detachedAt] as const]
					)
		)
	);
	const delivered = new Set(
		householdVersions.map(({ householdId, versionId }) => `${householdId}\u0000${versionId}`)
	);
	return (householdId, version) => {
		const rows = (byHousehold.get(householdId) ?? []).filter(
			({ workosUserId }) => workosUserId === version.ownerUserId
		);
		if (rows.length === 0) return delivered.has(`${householdId}\u0000${version.id}`);
		const snapshotEnd = snapshotEnds.get(householdId);
		const standing = ownerStanding(
			rows.map(({ status, detachedAt, updatedAt }) => {
				const end = status === 'active' ? null : (detachedAt ?? updatedAt);
				if (snapshotEnd === undefined) return end;
				return end !== null && end < snapshotEnd ? end : snapshotEnd;
			})
		);
		return householdSeesVersion(version, standing);
	};
};

/** Reads what {@link deviceVersionVisibility} needs for these households. */
export const readVersionVisibility = async (
	database: MaalDatabase,
	householdIds: readonly string[]
): Promise<DeviceVersionVisibility> => {
	const [memberships, householdVersions] = await Promise.all([
		database.memberships.where('householdId').anyOf(householdIds).toArray(),
		database.householdVersions.where('householdId').anyOf(householdIds).toArray()
	]);
	return { memberships, householdVersions };
};

/**
 * Reads what these meals resolve against on this device: the versions of their recipes each meal's
 * household sees, their check-ins, and their households' timezones (spec §5.3, §8.7). Inside a live
 * query, the reads make the query re-run when a version arrives, a check-in pins one, a membership
 * changes, or a timezone changes.
 */
export const loadMealResolution = async (
	database: MaalDatabase,
	meals: readonly LiveMeal[]
): Promise<(meal: RecipeFollowingMeal) => MealResolutionContext> => {
	const following = meals.filter(isRecipeFollowingMeal);
	if (following.length === 0) return () => ({ versions: [], checkIns: [], timeZone: null });
	const householdIds = [...new Set(following.map(({ householdId }) => householdId))];
	const [versions, checkInRows, households, visibility] = await Promise.all([
		readRecipeVersions(
			database,
			following.map(({ sourceRecipeId }) => sourceRecipeId)
		),
		database.mealCheckIns
			.where('mealId')
			.anyOf(following.map(({ id }) => id))
			.toArray(),
		database.households.bulkGet(householdIds),
		readVersionVisibility(database, householdIds)
	]);
	const sees = deviceVersionVisibility(visibility);
	const versionsByRecipe = Map.groupBy(versions, ({ recipeId }) => recipeId);
	const checkInsByMeal = Map.groupBy(checkInRows.map(decodeCheckIn), ({ mealId }) => mealId);
	const timeZones = new Map(
		householdIds.map((id, index) => [id, households[index]?.timezone ?? null] as const)
	);
	return (meal) => ({
		versions: (versionsByRecipe.get(meal.sourceRecipeId) ?? []).filter((version) =>
			sees(meal.householdId, version)
		),
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
