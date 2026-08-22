import { liveQuery } from 'dexie';
import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import { LocalDateSchema } from '$lib/domain/contracts/primitives.js';
import {
	MealAggregateSchema,
	MealCheckInSchema,
	StoredMealSchema,
	isMealAggregate,
	type MealAggregate,
	type MealCheckIn
} from '$lib/domain/meals/schema.js';

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

const decodeMealRows = (rows: readonly unknown[]): MealAggregate[] =>
	rows
		.map(decodeMeal)
		.filter((meal): meal is MealAggregate => isMealAggregate(meal) && meal.deletedAt === null)
		.map((meal) => Schema.decodeUnknownSync(MealAggregateSchema)(meal));

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
	return decodeMealRows(await queryHouseholdMealRangeRows(database, householdId, decodedRange));
};

export const listHouseholdMeals = async (
	database: MaalDatabase,
	householdId: string
): Promise<MealAggregate[]> =>
	(await database.meals.where('householdId').equals(householdId).toArray())
		.map(decodeMeal)
		.filter((meal): meal is MealAggregate => isMealAggregate(meal) && meal.deletedAt === null)
		.map((meal) => Schema.decodeUnknownSync(MealAggregateSchema)(meal));

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
	const meals = decodeMealRows(mealRows);
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
