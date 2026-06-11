import { browser } from '$app/environment';
import { dateFromKey } from '$lib/components/dashboard/schedule-date';
import { moveMealToDropTarget } from '$lib/components/dashboard/schedule-dnd';
import { isMealInPool } from '$lib/components/dashboard/schedule-ordering';
import type { Meal, MealDropTarget } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';
import { atom, computed } from 'nanostores';

export type ScheduleMealChangeSource = 'drag' | 'preview' | 'hydrate' | 'external';

export type ScheduleMealChange = {
	source: ScheduleMealChangeSource;
	meal: Meal;
	previousMeal?: Meal;
	meals: Meal[];
};

export type ScheduleMealChangeHook = (change: ScheduleMealChange) => void | Promise<void>;

const cloneMeal = (meal: Meal): Meal => ({
	...meal,
	ingredients: meal.ingredients ? [...meal.ingredients] : undefined,
	instructions: meal.instructions ? [...meal.instructions] : undefined
});
const cloneMeals = (meals: Meal[]): Meal[] => meals.map(cloneMeal);

const normalizedServings = (servings: number | undefined): number => {
	const value = servings ?? 1;
	return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
};

const recipeIngredientText = (
	ingredient: NonNullable<RecipeMenuItem['ingredients']>[number]
): string => [ingredient.amount.trim(), ingredient.item.trim()].filter(Boolean).join(' ');

const mealFromRecipe = (
	recipe: RecipeMenuItem,
	plannedServings: number,
	overrides: Partial<Meal> = {}
): Meal => ({
	id: recipe.id,
	userRecipeId: recipe.id,
	title: recipe.title,
	description: recipe.description,
	image: recipe.image,
	cookTimeMinutes: recipe.cookTimeMinutes,
	servingsPlanned: normalizedServings(plannedServings),
	baseServings: normalizedServings(recipe.servings ?? plannedServings),
	ingredients: recipe.ingredients?.map(recipeIngredientText),
	instructions: recipe.instructions?.map((instruction) => instruction.text),
	...overrides
});

const weekdayName = (date: Date): string =>
	new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);

const newLocalMealId = (): string =>
	`local-meal-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

const changeHooks = new Set<ScheduleMealChangeHook>();
const pendingCreateMealIds = new Set<string>();
const deletedMealIds = new Set<string>();

const isRecipePoolTemplate = (meal: Meal): boolean =>
	isMealInPool(meal) && Boolean(meal.userRecipeId) && meal.id === meal.userRecipeId;

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
	fetch('/plan/meals', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ mealId })
	})
		.then(async (response) => {
			if (!response.ok) throw new Error(await response.text());
			deletedMealIds.delete(mealId);
		})
		.catch(
			onFailure ?? ((error: unknown) => console.error('Failed to delete schedule meal', error))
		);
};

const persistExistingScheduleMeal = (
	meal: Meal,
	previousMealId = meal.id,
	onFailure?: (error: unknown) => void
) => {
	if (!browser) return;
	fetch('/plan/meals', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ meal })
	})
		.then(async (response) => {
			if (!response.ok) throw new Error(await response.text());
			const body = (await response.json()) as { meal: Meal };
			replaceMeal(body.meal, previousMealId);
		})
		.catch(
			onFailure ?? ((error: unknown) => console.error('Failed to persist schedule meal', error))
		);
};

const persistScheduleMealChange = (change: ScheduleMealChange) => {
	if (!browser || change.source === 'hydrate' || change.source === 'external') return;
	if (pendingCreateMealIds.has(change.meal.id)) return;

	persistExistingScheduleMeal(change.meal, change.meal.id, (error: unknown) => {
		console.error('Failed to persist schedule meal', error);
		if (change.previousMeal) replaceMeal(change.previousMeal, change.meal.id);
	});
};

const setScheduleMeals = (
	meals: Meal[],
	source: ScheduleMealChangeSource,
	changedMealId?: string,
	previousMeal?: Meal
) => {
	scheduleMealStore.set(cloneMeals(meals));
	if (!changedMealId) return;
	const meal = meals.find((candidate) => candidate.id === changedMealId);
	if (!meal) return;
	emitScheduleMealChange({ source, meal, previousMeal, meals });
};

export const hydrateScheduleMeals = (meals: Meal[]) => {
	setScheduleMeals(cloneMeals(meals), 'hydrate');
};

export const mergeHydratedScheduleMeals = (meals: Meal[], startDate: string, endDate: string) => {
	const incomingMeals = cloneMeals(meals);
	const incomingIds = new Set(incomingMeals.map((meal) => meal.id));
	const outsideRangeOrPending = scheduleMealStore.get().filter((meal) => {
		if (incomingIds.has(meal.id)) return false;
		if (pendingCreateMealIds.has(meal.id)) return true;
		if (!meal.date) return false;
		return meal.date < startDate || meal.date > endDate;
	});
	setScheduleMeals([...outsideRangeOrPending, ...incomingMeals], 'hydrate');
};

export const selectScheduleMeal = (mealId: string | null) => {
	selectedMealIdStore.set(mealId);
};

const scheduleFieldsChanged = (left: Meal, right: Meal): boolean =>
	(left.date ?? '') !== (right.date ?? '') ||
	(left.time ?? '') !== (right.time ?? '') ||
	(left.sortOrder ?? 0) !== (right.sortOrder ?? 0) ||
	(left.servingsPlanned ?? 1) !== (right.servingsPlanned ?? 1);

const persistNewScheduleMeal = (meal: Meal, previousMealId = meal.id) => {
	if (!browser) return;
	pendingCreateMealIds.add(previousMealId);
	fetch('/plan/meals', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ meal })
	})
		.then(async (response) => {
			if (!response.ok) throw new Error(await response.text());
			const body = (await response.json()) as { meal: Meal };
			if (deletedMealIds.has(previousMealId)) {
				pendingCreateMealIds.delete(previousMealId);
				deletedMealIds.add(body.meal.id);
				persistDeletedScheduleMeal(body.meal.id);
				return;
			}
			const currentMeal = scheduleMealStore
				.get()
				.find((candidate) => candidate.id === previousMealId);
			const reconciledMeal = currentMeal
				? { ...body.meal, ...currentMeal, id: body.meal.id }
				: body.meal;
			pendingCreateMealIds.delete(previousMealId);
			replaceMeal(reconciledMeal, previousMealId);
			if (currentMeal && scheduleFieldsChanged(currentMeal, meal)) {
				persistExistingScheduleMeal(reconciledMeal);
			}
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
	defaultServings = 1
) => {
	const existingPoolMeal = scheduleMealStore.get().find((meal) => meal.id === recipe.id);
	if (!date && existingPoolMeal) {
		selectedMealIdStore.set(existingPoolMeal.id);
		return existingPoolMeal;
	}

	const meal = mealFromRecipe(recipe, defaultServings, {
		id: date ? newLocalMealId() : recipe.id,
		date,
		day: date ? weekdayName(dateFromKey(date)) : undefined
	});
	scheduleMealStore.set([...scheduleMealStore.get(), cloneMeal(meal)]);
	selectedMealIdStore.set(meal.id);
	if (date) persistNewScheduleMeal(meal);
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
	if (!browser || pendingCreateMealIds.has(meal.id)) return;
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
	if (target.kind === 'date' && previousMeal && isRecipePoolTemplate(previousMeal)) {
		const scheduledMeal = {
			...cloneMeal(draggedMeal),
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
		return;
	}

	const meals = moveMealToDropTarget(currentMeals, draggedMeal, target);
	setScheduleMeals(meals, 'drag', draggedMeal.id, previousMeal);
};
