import { and, eq } from 'drizzle-orm';
import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';
import { getDb } from '$lib/server/db';
import { householdMeals, mealCheckIns } from '$lib/server/db/schema';

export type MealCheckInInput = {
	householdId: string;
	workosUserId: string;
	mealId: string;
	verdict: MealFeedbackVerdict;
	cooked: boolean;
	cookTime: number | null;
	reason: string | null;
};

type Db = ReturnType<typeof getDb>;

export const upsertMealCheckIn = async (db: Db, input: MealCheckInInput) => {
	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(
			and(eq(householdMeals.id, input.mealId), eq(householdMeals.householdId, input.householdId))
		)
		.get();
	if (!existingMeal) throw new Error('Meal not found.');

	const cookTime =
		input.cooked && existingMeal.plannedCookWorkosUserId === input.workosUserId
			? input.cookTime
			: null;
	const reason = input.reason?.trim() || null;
	const updatedAt = new Date().toISOString();

	await db.transaction(async (tx) => {
		await tx
			.insert(mealCheckIns)
			.values({
				workosUserId: input.workosUserId,
				householdMealId: input.mealId,
				verdict: input.verdict,
				cookTime,
				reason,
				updatedAt
			})
			.onConflictDoUpdate({
				target: [mealCheckIns.householdMealId, mealCheckIns.workosUserId],
				set: {
					verdict: input.verdict,
					cookTime,
					reason,
					updatedAt
				}
			});

		await tx
			.update(householdMeals)
			.set({
				status: input.cooked ? 'cooked' : 'skipped',
				updatedAt
			})
			.where(eq(householdMeals.id, input.mealId));
	});
};
