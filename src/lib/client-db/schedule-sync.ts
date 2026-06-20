import type { Meal } from '$lib/components/dashboard/schedule-types';
import {
	createScheduleMealRemote,
	deleteScheduleMealRemote,
	fetchScheduleMealRange,
	ScheduleMealClientError,
	updateScheduleMealRemote
} from '$lib/components/dashboard/schedule-meal-client';
import { logClientDbDebug } from './debug';
import { deleteMealFromDexie, writeMealsToDexie } from './repositories';
import { queueRemoteSync } from './sync';

export const isScheduleSyncErrorWithStatus = (error: unknown, status: number): boolean =>
	error instanceof ScheduleMealClientError && error.status === status;

export const syncMealRangeFromRemote = async (range: { start: string; end: string }) => {
	logClientDbDebug('dexie->d1', 'fetch meal range', { extra: range });
	const meals = await fetchScheduleMealRange(range);
	logClientDbDebug('d1->dexie', 'fetched meal range', {
		count: meals.length,
		ids: meals.map((meal) => meal.id),
		extra: range
	});
	await writeMealsToDexie(meals);
	return meals;
};

export const syncCreatedMealToRemote = async (meal: Meal): Promise<Meal> =>
	(await queueRemoteSync({
		entity: 'plannedMeal',
		operation: 'create',
		entityId: meal.id,
		payload: meal,
		remote: () => createScheduleMealRemote(meal)
	})) as Meal;

export const syncUpdatedMealToRemote = async (meal: Meal): Promise<void> => {
	await queueRemoteSync({
		entity: 'plannedMeal',
		operation: 'update',
		entityId: meal.id,
		payload: meal,
		remote: () => updateScheduleMealRemote(meal)
	});
};

export const syncDeletedMealToRemote = async (mealId: string): Promise<void> => {
	await deleteMealFromDexie(mealId);
	await queueRemoteSync({
		entity: 'plannedMeal',
		operation: 'delete',
		entityId: mealId,
		payload: { mealId },
		remote: () => deleteScheduleMealRemote(mealId)
	});
};
