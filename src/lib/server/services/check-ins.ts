import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';
import {
	parseMealFeedbackVerdict,
	parseOptionalBoolean,
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
	cooked?: unknown;
	cookTime?: unknown;
	reason?: string | null;
}) => {
	const mealId = parseRequiredText(input.mealId);
	const verdict = parseMealFeedbackVerdict(input.verdict);
	const cooked = parseOptionalBoolean(input.cooked, true);
	const cookTime = parseOptionalPositiveInteger(input.cookTime);
	if (!mealId) throw new Error('Meal is required.');
	if (!verdict) throw new Error('Verdict is required.');
	if (cooked === null) throw new Error('Cooked must be true or false.');
	if (
		input.cookTime !== undefined &&
		input.cookTime !== null &&
		input.cookTime !== '' &&
		cookTime === null
	) {
		throw new Error('Cook time must be a positive whole number.');
	}
	await upsertMealCheckInCore(input.db, {
		householdId: input.householdId,
		workosUserId: input.workosUserId,
		mealId,
		verdict,
		cooked,
		cookTime,
		reason: input.reason ?? null
	});
	return { ok: true };
};
