import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';
import {
	parseMealFeedbackVerdict,
	parseOptionalPositiveInteger,
	parseRequiredText
} from '$lib/domain/meal-feedback-validation';
import { getDb } from '$lib/server/db';
import { upsertMealCheckIn as upsertMealCheckInCore } from './meal-check-ins';

type Db = ReturnType<typeof getDb>;

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
	const mealId = parseRequiredText(input.mealId);
	const verdict = parseMealFeedbackVerdict(input.verdict);
	if (!mealId) throw new Error('Meal is required.');
	if (!verdict) throw new Error('Verdict is required.');
	await upsertMealCheckInCore(input.db, {
		householdId: input.householdId,
		workosUserId: input.workosUserId,
		mealId,
		verdict,
		cooked: input.cooked !== false,
		cookTime: parseOptionalPositiveInteger(input.cookTime),
		reason: input.reason ?? null
	});
	return { ok: true };
};
