import { browser } from '$app/environment';
import {
	deleteMealFromDexie,
	readMealsFromDexie,
	writeMealsToDexie
} from '$lib/client-db/repositories';
import { enqueueRemoteSync } from '$lib/client-db/sync';
import { dateFromKey } from '$lib/components/dashboard/schedule-date';
import { moveMealToDropTarget } from '$lib/components/dashboard/schedule-dnd';
import { isMealInPool } from '$lib/components/dashboard/schedule-ordering';
import type { Meal, MealDropTarget } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';
import { convertInstructionTemperatures, type UnitPreferences } from '$lib/recipes/ingredient-text';
import { atom, computed } from 'nanostores';

export type ScheduleMealChangeSource = 'drag' | 'preview' | 'hydrate' | 'external';

export type ScheduleMealChange = {
	source: ScheduleMealChangeSource;
	meal: Meal;
	previousMeal?: Meal;
	meals: Meal[];
};

export type ScheduleMealChangeHook = (change: ScheduleMealChange) => void | Promise<void>;

export type ScheduleMealStoreSnapshot = {
	meals: Meal[];
	selectedMealId: string | null;
};

const cloneMeal = (meal: Meal): Meal => ({
	...meal,
	ingredients: meal.ingredients ? [...meal.ingredients] : undefined,
	instructions: meal.instructions ? [...meal.instructions] : undefined
});
const cloneMeals = (meals: Meal[]): Meal[] => meals.map(cloneMeal);

const uniqueMeals = (meals: Meal[]): Meal[] => {
	const seen = new Set<string>();
	const unique: Meal[] = [];
	for (const meal of meals) {
		if (seen.has(meal.id)) continue;
		seen.add(meal.id);
		unique.push(meal);
	}
	return unique;
};

const normalizedServings = (servings: number | undefined): number => {
	const value = servings ?? 1;
	return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
};

const recipeIngredientText = (
	ingredient: NonNullable<RecipeMenuItem['ingredients']>[number]
): string =>
	[ingredient.amount.trim(), ingredient.unit?.trim(), ingredient.item.trim()]
		.filter(Boolean)
		.join(' ');

const mealFromRecipe = (
	recipe: RecipeMenuItem,
	plannedServings: number,
	overrides: Partial<Meal> = {},
	unitPreferences: UnitPreferences = {}
): Meal => ({
	id: recipe.id,
	userRecipeId: recipe.id,
	title: recipe.title,
	description: recipe.description,
	image: recipe.image,
	cookTimeMinutes: recipe.cookTimeMinutes,
	servingsPlanned: normalizedServings(plannedServings),
	baseServings: normalizedServings(recipe.yield ?? plannedServings),
	ingredients: recipe.ingredients?.map(recipeIngredientText),
	instructions: recipe.instructions?.map((instruction) =>
		convertInstructionTemperatures(instruction.text, unitPreferences)
	),
	...overrides
});

const weekdayName = (date: Date): string =>
	new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);

const localMealIdPrefix = 'local-meal-';
const newLocalMealId = (): string =>
	`${localMealIdPrefix}${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const isLocalMealId = (mealId: string): boolean => mealId.startsWith(localMealIdPrefix);
const writePersistedMealsToDexie = (meals: Meal[]) =>
	writeMealsToDexie(meals.filter((meal) => !isLocalMealId(meal.id)));

const changeHooks = new Set<ScheduleMealChangeHook>();
const pendingCreateMealIds = new Set<string>();
const deletedMealIds = new Set<string>();
const pendingPersistVersions = new Map<string, number>();
const optimisticMealSnapshots = new Map<string, Meal>();
let nextPersistVersion = 0;

const isRecipePoolTemplate = (meal: Meal): boolean =>
	isMealInPool(meal) && Boolean(meal.userRecipeId) && meal.id === meal.userRecipeId;

const arraysMatch = (left: string[] = [], right: string[] = []): boolean =>
	left.length === right.length && left.every((value, index) => value === right[index]);

const mealsMatch = (left: Meal, right: Meal): boolean =>
	left.id === right.id &&
	(left.userRecipeId ?? '') === (right.userRecipeId ?? '') &&
	left.title === right.title &&
	(left.date ?? '') === (right.date ?? '') &&
	(left.time ?? '') === (right.time ?? '') &&
	(left.sortOrder ?? 0) === (right.sortOrder ?? 0) &&
	(left.status ?? '') === (right.status ?? '') &&
	(left.plannedCookWorkosUserId ?? '') === (right.plannedCookWorkosUserId ?? '') &&
	(left.cookTimeMinutes ?? 0) === (right.cookTimeMinutes ?? 0) &&
	(left.servingsPlanned ?? 1) === (right.servingsPlanned ?? 1) &&
	(left.baseServings ?? 1) === (right.baseServings ?? 1) &&
	(left.image ?? '') === (right.image ?? '') &&
	(left.description ?? '') === (right.description ?? '') &&
	arraysMatch(left.ingredients, right.ingredients) &&
	arraysMatch(left.instructions, right.instructions);

export const scheduleMealStore = atom<Meal[]>([]);
export const selectedMealIdStore = atom<string | null>(null);
export const selectedMealStore = computed(
	[scheduleMealStore, selectedMealIdStore],
	(meals, selectedMealId) => meals.find((meal) => meal.id === selectedMealId) ?? null
);

export const addScheduleMealChangeHook = (hook: ScheduleMealChangeHook): (() => void) => {
	changeHooks.add(hook);
	return () => changeHooks.delete(hook);
};

const replaceMeal = (
	meal: Meal,
	previousMealId = meal.id,
	source: ScheduleMealChangeSource = 'external'
) => {
	if (deletedMealIds.has(previousMealId) || deletedMealIds.has(meal.id)) return;
	const meals = scheduleMealStore
		.get()
		.filter((candidate) => candidate.id === previousMealId || candidate.id !== meal.id)
		.map((candidate) => (candidate.id === previousMealId ? cloneMeal(meal) : candidate));
	setScheduleMeals(meals, source);
	if (selectedMealIdStore.get() === previousMealId) selectedMealIdStore.set(meal.id);
};

const removeMeal = (mealId: string) => {
	scheduleMealStore.set(scheduleMealStore.get().filter((meal) => meal.id !== mealId));
	if (selectedMealIdStore.get() === mealId) selectedMealIdStore.set(null);
};

const emitScheduleMealChange = (change: ScheduleMealChange) => {
	for (const hook of changeHooks) {
		Promise.resolve(hook(change)).catch((error: unknown) => {
			console.error('Schedule meal change hook failed', error);
		});
	}
	persistScheduleMealChange(change);
};

const persistDeletedScheduleMeal = (mealId: string, onFailure?: (error: unknown) => void) => {
	if (!browser) return;
	enqueueRemoteSync({
		entity: 'plannedMeal',
		operation: 'delete',
		entityId: mealId,
		payload: { mealId }
	})
		.then(() => {
			deletedMealIds.delete(mealId);
		})
		.catch(
			onFailure ?? ((error: unknown) => console.error('Failed to delete schedule meal', error))
		);
};

const mealWithoutSidecars = (meal: Meal): Meal => {
	const nextMeal = { ...meal };
	delete nextMeal.ingredients;
	delete nextMeal.instructions;
	return nextMeal;
};

const persistExistingScheduleMeal = (
	meal: Meal,
	onFailure?: (error: unknown) => void,
	onSuccess?: () => void
) => {
	if (!browser) return;
	enqueueRemoteSync({
		entity: 'plannedMeal',
		operation: 'update',
		entityId: meal.id,
		payload: { meal }
	})
		.then(() => {
			onSuccess?.();
		})
		.catch(
			onFailure ?? ((error: unknown) => console.error('Failed to persist schedule meal', error))
		);
};

const persistScheduleMealChange = (change: ScheduleMealChange) => {
	if (!browser || change.source === 'hydrate' || change.source === 'external') return;
	if (pendingCreateMealIds.has(change.meal.id)) return;

	const persistVersion = ++nextPersistVersion;
	pendingPersistVersions.set(change.meal.id, persistVersion);
	optimisticMealSnapshots.set(change.meal.id, cloneMeal(change.meal));
	persistExistingScheduleMeal(
		change.source === 'drag' ? mealWithoutSidecars(change.meal) : change.meal,
		(error: unknown) => {
			console.error('Failed to persist schedule meal', error);
			if (pendingPersistVersions.get(change.meal.id) !== persistVersion) return;
			pendingPersistVersions.delete(change.meal.id);
			optimisticMealSnapshots.delete(change.meal.id);
			if (change.previousMeal) replaceMeal(change.previousMeal, change.meal.id);
		},
		() => {
			if (pendingPersistVersions.get(change.meal.id) === persistVersion) {
				pendingPersistVersions.delete(change.meal.id);
			}
			// Keep the optimistic snapshot after success. A stale range-load response can still
			// arrive after the PUT resolves; clear the snapshot only when hydration confirms
			// the server has caught up to this exact meal state.
		}
	);
};

const setScheduleMeals = (
	meals: Meal[],
	source: ScheduleMealChangeSource,
	changedMealId?: string,
	previousMeal?: Meal
) => {
	scheduleMealStore.set(cloneMeals(uniqueMeals(meals)));
	if (!changedMealId) return;
	const meal = meals.find((candidate) => candidate.id === changedMealId);
	if (!meal) return;
	emitScheduleMealChange({ source, meal, previousMeal, meals });
};

export const hydrateScheduleMeals = (meals: Meal[]) => {
	setScheduleMeals(cloneMeals(meals), 'hydrate');
	void writePersistedMealsToDexie(meals);
};

export const hydrateScheduleMealsFromDexie = async () => {
	const meals = await readMealsFromDexie();
	const persistedMeals = meals.filter((meal) => !isLocalMealId(meal.id));
	const staleLocalMealIds = meals.filter((meal) => isLocalMealId(meal.id)).map((meal) => meal.id);
	for (const mealId of staleLocalMealIds) void deleteMealFromDexie(mealId);
	if (persistedMeals.length) setScheduleMeals(persistedMeals, 'hydrate');
	return persistedMeals;
};

export const mergeHydratedScheduleMeals = (meals: Meal[], startDate: string, endDate: string) => {
	const currentMeals = scheduleMealStore.get();
	const incomingMeals = uniqueMeals(cloneMeals(meals)).filter(
		(meal) => !deletedMealIds.has(meal.id)
	);
	const incomingById = new Map(incomingMeals.map((meal) => [meal.id, meal]));
	const optimisticIdsToKeep = new Set<string>();

	for (const currentMeal of currentMeals) {
		const optimisticSnapshot = optimisticMealSnapshots.get(currentMeal.id);
		if (!optimisticSnapshot) continue;
		const incomingMeal = incomingById.get(currentMeal.id);
		if (incomingMeal && mealsMatch(incomingMeal, optimisticSnapshot)) {
			optimisticMealSnapshots.delete(currentMeal.id);
			continue;
		}
		optimisticIdsToKeep.add(currentMeal.id);
	}

	const incomingIds = new Set(incomingMeals.map((meal) => meal.id));
	const outsideRangeOrPending = currentMeals.filter((meal) => {
		if (optimisticIdsToKeep.has(meal.id)) return true;
		if (incomingIds.has(meal.id)) return false;
		if (pendingCreateMealIds.has(meal.id)) return true;
		if (!meal.date) return true;
		return meal.date < startDate || meal.date > endDate;
	});
	const incomingToMerge = incomingMeals.filter((meal) => !optimisticIdsToKeep.has(meal.id));
	const mergedMeals = [...outsideRangeOrPending, ...incomingToMerge];
	setScheduleMeals(mergedMeals, 'hydrate');
	void writePersistedMealsToDexie(mergedMeals);
};

export const selectScheduleMeal = (mealId: string | null) => {
	selectedMealIdStore.set(mealId);
};

const scheduleFieldsChanged = (left: Meal, right: Meal): boolean =>
	(left.date ?? '') !== (right.date ?? '') ||
	(left.time ?? '') !== (right.time ?? '') ||
	(left.sortOrder ?? 0) !== (right.sortOrder ?? 0) ||
	(left.servingsPlanned ?? 1) !== (right.servingsPlanned ?? 1);

const emitChangedScheduleMealChanges = (
	meals: Meal[],
	previousMeals: Meal[],
	source: ScheduleMealChangeSource,
	ignoredMealIds = new Set<string>()
) => {
	const previousMealsById = new Map(previousMeals.map((meal) => [meal.id, meal]));
	for (const meal of meals) {
		if (ignoredMealIds.has(meal.id)) continue;
		const previousMeal = previousMealsById.get(meal.id);
		if (!previousMeal || !scheduleFieldsChanged(previousMeal, meal)) continue;
		emitScheduleMealChange({ source, meal, previousMeal, meals });
	}
};

const persistNewScheduleMeal = (meal: Meal, previousMealId = meal.id) => {
	if (!browser) return;
	pendingCreateMealIds.add(previousMealId);
	enqueueRemoteSync({
		entity: 'plannedMeal',
		operation: 'create',
		entityId: previousMealId,
		payload: { meal }
	})
		.then(() => {
			pendingCreateMealIds.delete(previousMealId);
		})
		.catch((error: unknown) => {
			pendingCreateMealIds.delete(previousMealId);
			console.error('Failed to create schedule meal', error);
			removeMeal(previousMealId);
		});
};

export const addScheduleMealFromRecipe = (
	recipe: RecipeMenuItem,
	date?: string,
	defaultServings = 1,
	unitPreferences: UnitPreferences = {}
) => {
	const meal = mealFromRecipe(
		recipe,
		defaultServings,
		{
			id: newLocalMealId(),
			date,
			day: date ? weekdayName(dateFromKey(date)) : undefined
		},
		unitPreferences
	);
	scheduleMealStore.set([...scheduleMealStore.get(), cloneMeal(meal)]);
	selectedMealIdStore.set(meal.id);
	persistNewScheduleMeal(meal);
	return meal;
};

export const addScheduleMeal = (date?: string, defaultServings = 1) => {
	const day = date ? weekdayName(dateFromKey(date)) : undefined;
	const meal: Meal = {
		id: newLocalMealId(),
		title: 'New meal',
		date,
		day,
		description: '',
		cookTimeMinutes: 30,
		servingsPlanned: normalizedServings(defaultServings),
		baseServings: normalizedServings(defaultServings),
		familiarity: 'safe'
	};
	scheduleMealStore.set([...scheduleMealStore.get(), cloneMeal(meal)]);
	selectedMealIdStore.set(meal.id);

	persistNewScheduleMeal(meal);

	return meal;
};

export const updateScheduleMeal = (meal: Meal, source: ScheduleMealChangeSource = 'preview') => {
	const previousMeal = scheduleMealStore.get().find((candidate) => candidate.id === meal.id);
	const day = meal.date ? weekdayName(dateFromKey(meal.date)) : undefined;
	const meals = scheduleMealStore
		.get()
		.map((currentMeal) =>
			currentMeal.id === meal.id ? { ...currentMeal, ...meal, day } : currentMeal
		);
	setScheduleMeals(meals, source, meal.id, previousMeal);
	void writePersistedMealsToDexie(meals);
};

export const updateScheduleMealSchedule = (
	meal: Meal,
	source: ScheduleMealChangeSource = 'preview'
) => {
	updateScheduleMeal(meal, source);
};

export const deleteScheduleMeal = (meal: Meal) => {
	const previousMeals = scheduleMealStore.get();
	deletedMealIds.add(meal.id);
	removeMeal(meal.id);
	void deleteMealFromDexie(meal.id);
	if (!browser || pendingCreateMealIds.has(meal.id)) return;
	if (isRecipePoolTemplate(meal)) {
		deletedMealIds.delete(meal.id);
		return;
	}
	persistDeletedScheduleMeal(meal.id, (error: unknown) => {
		console.error('Failed to delete schedule meal', error);
		deletedMealIds.delete(meal.id);
		scheduleMealStore.set(cloneMeals(previousMeals));
	});
};

export const moveScheduleMealToDropTarget = (
	draggedMeal: Meal,
	target: MealDropTarget,
	defaultServings = 1
) => {
	const currentMeals = scheduleMealStore.get();
	const previousMeal = currentMeals.find((meal) => meal.id === draggedMeal.id);
	const mealToMove = previousMeal ?? draggedMeal;
	if (target.kind === 'date' && previousMeal && isRecipePoolTemplate(previousMeal)) {
		const scheduledMeal = {
			...cloneMeal(mealToMove),
			id: newLocalMealId(),
			date: target.date,
			day: weekdayName(dateFromKey(target.date)),
			servingsPlanned: normalizedServings(defaultServings)
		};
		const mealsWithScheduledMeal = currentMeals.map((meal) =>
			meal.id === previousMeal.id ? scheduledMeal : meal
		);
		const meals = moveMealToDropTarget(mealsWithScheduledMeal, scheduledMeal, target);
		scheduleMealStore.set(cloneMeals(meals));
		persistNewScheduleMeal(meals.find((meal) => meal.id === scheduledMeal.id) ?? scheduledMeal);
		emitChangedScheduleMealChanges(meals, currentMeals, 'drag', new Set([scheduledMeal.id]));
		return;
	}

	const meals = moveMealToDropTarget(currentMeals, mealToMove, target);
	setScheduleMeals(meals, 'drag');
	emitChangedScheduleMealChanges(meals, currentMeals, 'drag');
};
