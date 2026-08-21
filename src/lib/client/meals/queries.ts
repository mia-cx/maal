import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import {
	MealAggregateSchema,
	MealCheckInSchema,
	StoredMealSchema,
	isMealAggregate,
	type MealAggregate,
	type MealCheckIn
} from '$lib/domain/meals/schema.js';

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
): Promise<MealCheckIn[]> =>
	(await database.mealCheckIns.toArray())
		.map((row) => Schema.decodeUnknownSync(MealCheckInSchema)(row))
		.filter(
			(row) => row.deletedAt === null && (row.mealId === null || householdMealIds.has(row.mealId))
		);
