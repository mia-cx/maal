import { and, eq } from 'drizzle-orm';
import type { MealFeedbackVerdict } from '$lib/components/dashboard/meal-labels';
import { getDb } from '$lib/server/db';
import { householdMeals, mealCheckIns } from '$lib/server/db/schema';

type Db = ReturnType<typeof getDb>;

const verdicts = new Set<MealFeedbackVerdict>(['repeat', 'neutral', 'avoid']);

const positiveInteger = (value: unknown): number | null => {
	if (value === undefined || value === null || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

export const upsertMealCheckIn = async (input: {
	db: Db;
	workosUserId: string;
	householdId: string;
	mealId: string;
	verdict: MealFeedbackVerdict;
	cooked?: boolean;
	cookTime?: unknown;
	reason?: string | null;
}) => {
	if (!input.mealId) throw new Error('Meal is required.');
	if (!verdicts.has(input.verdict)) throw new Error('Verdict is required.');
	const existingMeal = await input.db
		.select()
		.from(householdMeals)
		.where(
			and(eq(householdMeals.id, input.mealId), eq(householdMeals.householdId, input.householdId))
		)
		.get();
	if (!existingMeal) throw new Error('Meal not found.');

	const cooked = input.cooked !== false;
	const canReportCookTime = existingMeal.plannedCookWorkosUserId === input.workosUserId;
	const cookTime = cooked && canReportCookTime ? positiveInteger(input.cookTime) : null;
	const updatedAt = new Date().toISOString();

	await input.db
		.insert(mealCheckIns)
		.values({
			workosUserId: input.workosUserId,
			householdMealId: input.mealId,
			verdict: input.verdict,
			cookTime,
			reason: input.reason?.trim() || null,
			updatedAt
		})
		.onConflictDoUpdate({
			target: [mealCheckIns.householdMealId, mealCheckIns.workosUserId],
			set: {
				verdict: input.verdict,
				cookTime,
				reason: input.reason?.trim() || null,
				updatedAt
			}
		});

	await input.db
		.update(householdMeals)
		.set({ status: cooked ? 'cooked' : 'skipped', updatedAt })
		.where(eq(householdMeals.id, input.mealId));

	return { ok: true };
};
