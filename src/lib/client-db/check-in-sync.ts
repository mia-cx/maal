import type { Meal } from '$lib/components/dashboard/schedule-types';
import type { MealCheckInPayload } from '$lib/components/dashboard/meal-check-in-dialog.svelte';
import { submitMealCheckIn } from '$lib/components/dashboard/schedule-check-ins';
import { writeMealsToDexie } from './repositories';
import { queueRemoteSync } from './sync';

export const syncMealCheckInToRemote = async (payload: MealCheckInPayload): Promise<Meal> => {
	const meal = (await queueRemoteSync({
		entity: 'plannedMeal',
		operation: 'update',
		entityId: payload.meal.id,
		payload: {
			mealId: payload.meal.id,
			cooked: payload.cooked,
			verdict: payload.verdict,
			cookTime: payload.cookTime,
			reason: payload.reason
		},
		remote: () => submitMealCheckIn(payload)
	})) as Meal;
	await writeMealsToDexie([meal]);
	return meal;
};
