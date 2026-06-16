import { error } from '@sveltejs/kit';
import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';
import { readJsonObject } from '$lib/server/http/request';
import type { MealCheckInInput } from './meal-check-ins';

const verdicts = new Set<MealFeedbackVerdict>(['repeat', 'neutral', 'avoid']);

const positiveInteger = (value: unknown): number | null => {
	if (value === undefined || value === null || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

export const readMealCheckInInput = async (
	request: Request,
	householdId: string,
	workosUserId: string
): Promise<MealCheckInInput> => {
	const body = await readJsonObject(request);
	const mealId = typeof body.mealId === 'string' ? body.mealId.trim() : '';
	const verdict = typeof body.verdict === 'string' ? body.verdict : '';
	if (!mealId) error(400, { message: 'Meal is required.' });
	if (!verdicts.has(verdict as MealFeedbackVerdict)) {
		error(400, { message: 'Verdict is required.' });
	}
	return {
		householdId,
		workosUserId,
		mealId,
		verdict: verdict as MealFeedbackVerdict,
		cooked: body.cooked !== false,
		cookTime: positiveInteger(body.cookTime),
		reason: typeof body.reason === 'string' ? body.reason.trim() : null
	};
};
