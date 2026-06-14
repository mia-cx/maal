import type { Meal } from './schedule-types';
import type { MealCheckInPayload } from './meal-check-in-dialog.svelte';

export const submitMealCheckIn = async ({
	meal,
	cooked,
	verdict,
	cookTime,
	reason
}: MealCheckInPayload): Promise<Meal> => {
	const response = await fetch('/plan/check-ins', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ mealId: meal.id, cooked, verdict, cookTime, reason })
	});
	if (!response.ok) throw new Error(await response.text());
	return {
		...meal,
		status: cooked ? 'cooked' : 'skipped',
		latestVerdict: verdict,
		latestCheckIn: { verdict, cookTime, reason: reason?.trim() || undefined }
	};
};
