import type { MealFeedbackVerdict } from '$lib/components/dashboard/meal-labels';
import { getDb } from '$lib/server/db';
import { upsertMealCheckIn as upsertMealCheckInCore } from './meal-check-ins';

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
	await upsertMealCheckInCore(input.db, {
		householdId: input.householdId,
		workosUserId: input.workosUserId,
		mealId: input.mealId,
		verdict: input.verdict,
		cooked: input.cooked !== false,
		cookTime: positiveInteger(input.cookTime),
		reason: input.reason ?? null
	});
	return { ok: true };
};
