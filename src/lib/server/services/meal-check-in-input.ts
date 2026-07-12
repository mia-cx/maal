import { error } from '@sveltejs/kit';
import {
	parseMealFeedbackVerdict,
	parseOptionalBoolean,
	parseOptionalPositiveInteger,
	parseRequiredText
} from '$lib/domain/meal-feedback-validation';
import { readJsonObject } from '$lib/server/http/request';
import type { MealCheckInInput } from './meal-check-ins';

export const readMealCheckInInput = async (
	request: Request,
	householdId: string,
	workosUserId: string
): Promise<MealCheckInInput> => {
	const body = await readJsonObject(request);
	const mealId = parseRequiredText(body.mealId);
	const verdict = parseMealFeedbackVerdict(body.verdict);
	const cooked = parseOptionalBoolean(body.cooked, true);
	const cookTime = parseOptionalPositiveInteger(body.cookTime);
	if (!mealId) error(400, { message: 'Meal is required.' });
	if (!verdict) error(400, { message: 'Verdict is required.' });
	if (cooked === null) error(400, { message: 'Cooked must be true or false.' });
	if (
		body.cookTime !== undefined &&
		body.cookTime !== null &&
		body.cookTime !== '' &&
		cookTime === null
	) {
		error(400, { message: 'Cook time must be a positive whole number.' });
	}
	return {
		householdId,
		workosUserId,
		mealId,
		verdict,
		cooked,
		cookTime,
		reason: typeof body.reason === 'string' ? body.reason.trim() : null
	};
};
