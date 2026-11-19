import { Dexie, liveQuery } from 'dexie';
import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import { LocalDateSchema } from '$lib/domain/contracts/primitives.js';
import { resolveMeal } from '$lib/domain/meals/recipe-following.js';
import {
	MealCheckInSchema,
	StoredMealSchema,
	isLiveMeal,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealAggregate,
	type MealCheckIn
} from '$lib/domain/meals/schema.js';
import { StoredRecipeSchema, type StoredRecipe } from '$lib/domain/recipes/schema.js';

export type MealCalendarRange = Readonly<{ start: string; end: string }>;

export type MealCalendarRangeRead = Readonly<{
	householdId: string;
	start: string;
	end: string;
	mealIndex: '[householdId+date]';
	mealRowsRead: number;
	checkInIndex: 'mealId';
	checkInRowsRead: number;
}>;

export type MealCalendarRangeResult = Readonly<{
	meals: MealAggregate[];
	checkIns: MealCheckIn[];
}>;

export type MealCalendarRangeInstrumentation = (read: MealCalendarRangeRead) => void;

const decodeMeal = (value: unknown) => {
	try {
		return Schema.decodeUnknownSync(StoredMealSchema)(value);
	} catch {
		throw new LocalDecodeError({
			operation: 'decode local meal',
			message: 'A local meal did not match its contract.'
		});
	}
};

const decodeRange = ({ start, end }: MealCalendarRange): MealCalendarRange => {
	const decoded = {
		start: Schema.decodeUnknownSync(LocalDateSchema)(start),
		end: Schema.decodeUnknownSync(LocalDateSchema)(end)
	};
	if (decoded.end < decoded.start) {
		throw new RangeError('The meal calendar range must end on or after its start date.');
	}
	return decoded;
};

const queryHouseholdMealRangeRows = async (
	database: MaalDatabase,
	householdId: string,
	range: MealCalendarRange
) =>
	database.meals
		.where('[householdId+date]')
		.between([householdId, range.start], [householdId, range.end], true, true)
		.toArray();

const decodeRecipe = (value: unknown): StoredRecipe => {
	try {
		return Schema.decodeUnknownSync(StoredRecipeSchema)(value);
	} catch {
		throw new LocalDecodeError({
			operation: 'decode followed recipe',
			message: 'A local recipe did not match its contract.'
		});
	}
};

/**
 * Decodes live, undeleted meals as readers show them: a recipe-following meal as its recipe is now.
 * Reading `recipes` inside a live query makes the query re-run when a followed recipe changes. A
 * meal whose recipe is not on this device yet is left out until it arrives (spec §5.3).
 */
export const resolveMealRows = async (
	database: MaalDatabase,
	rows: readonly unknown[]
): Promise<MealAggregate[]> => {
	const live = rows
		.map(decodeMeal)
		.filter((meal): meal is LiveMeal => isLiveMeal(meal) && meal.deletedAt === null);
	const recipeIds = [
		...new Set(live.filter(isRecipeFollowingMeal).map(({ sourceRecipeId }) => sourceRecipeId))
	];
	const recipes = recipeIds.length === 0 ? [] : await database.recipes.bulkGet(recipeIds);
	const recipeById = new Map(
		recipeIds.map((id, index) => {
			const row = recipes[index];
			return [id, row === undefined ? undefined : decodeRecipe(row)] as const;
		})
	);
	return live.flatMap((meal) => {
		const resolved = resolveMeal(
			meal,
			isRecipeFollowingMeal(meal) ? recipeById.get(meal.sourceRecipeId) : undefined
		);
		return resolved === null ? [] : [resolved];
	});
};

const queryMealCheckInRows = async (
	database: MaalDatabase,
	householdMealIds: ReadonlySet<string>
) =>
	householdMealIds.size === 0
		? []
		: database.mealCheckIns
				.where('mealId')
				.anyOf([...householdMealIds])
				.toArray();

const decodeMealCheckInRows = (rows: readonly unknown[]): MealCheckIn[] =>
	rows
		.map((row) => Schema.decodeUnknownSync(MealCheckInSchema)(row))
		.filter((row) => row.deletedAt === null && row.mealId !== null);

export const listHouseholdMealsInRange = async (
	database: MaalDatabase,
	householdId: string,
	range: MealCalendarRange
): Promise<MealAggregate[]> => {
	const decodedRange = decodeRange(range);
	return resolveMealRows(
		database,
		await queryHouseholdMealRangeRows(database, householdId, decodedRange)
	);
};

export const listHouseholdMeals = async (
	database: MaalDatabase,
	householdId: string
): Promise<MealAggregate[]> =>
	resolveMealRows(
		database,
		await database.meals.where('householdId').equals(householdId).toArray()
	);

export const listMealCheckIns = async (
	database: MaalDatabase,
	householdMealIds: ReadonlySet<string>
): Promise<MealCheckIn[]> => {
	return decodeMealCheckInRows(await queryMealCheckInRows(database, householdMealIds));
};

export const readMealCalendarRange = async (
	database: MaalDatabase,
	householdId: string,
	range: MealCalendarRange,
	onRead?: MealCalendarRangeInstrumentation
): Promise<MealCalendarRangeResult> => {
	const decodedRange = decodeRange(range);
	const mealRows = await queryHouseholdMealRangeRows(database, householdId, decodedRange);
	const meals = await resolveMealRows(database, mealRows);
	const checkInRows = await queryMealCheckInRows(database, new Set(meals.map(({ id }) => id)));
	const checkIns = decodeMealCheckInRows(checkInRows);
	onRead?.({
		householdId,
		...decodedRange,
		mealIndex: '[householdId+date]',
		mealRowsRead: mealRows.length,
		checkInIndex: 'mealId',
		checkInRowsRead: checkInRows.length
	});
	return { meals, checkIns };
};

export const liveMealCalendarRange = (
	database: MaalDatabase,
	householdId: string,
	range: MealCalendarRange,
	onRead?: MealCalendarRangeInstrumentation
) => liveQuery(() => readMealCalendarRange(database, householdId, range, onRead));

/**
 * Reads the household meal pool: every member's undated, non-deleted meals plus their check-ins.
 * IndexedDB leaves null dates out of `[householdId+date]`, so this diffs that index's keys
 * against the `householdId` index and loads only the undated rows.
 */
export const readMealPool = async (
	database: MaalDatabase,
	householdId: string
): Promise<MealCalendarRangeResult> => {
	const [householdKeys, datedKeys] = await Promise.all([
		database.meals.where('householdId').equals(householdId).primaryKeys(),
		database.meals
			.where('[householdId+date]')
			.between([householdId, Dexie.minKey], [householdId, Dexie.maxKey], true, true)
			.primaryKeys()
	]);
	const dated = new Set(datedKeys);
	const undatedKeys = householdKeys.filter((key) => !dated.has(key));
	const rows = await database.meals.bulkGet(undatedKeys);
	const meals = await resolveMealRows(
		database,
		rows.filter((row) => row !== undefined)
	);
	const checkIns = decodeMealCheckInRows(
		await queryMealCheckInRows(database, new Set(meals.map(({ id }) => id)))
	);
	return { meals, checkIns };
};

export const liveMealPool = (database: MaalDatabase, householdId: string) =>
	liveQuery(() => readMealPool(database, householdId));
