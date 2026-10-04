import { dateFromKey } from './schedule-date';
import {
	compareMealPoolOrder,
	compareScheduledMealOrder,
	isMealInPool,
	sortMealPool,
	sortScheduledMeals
} from './schedule-ordering';
import type { Meal, MealDropTarget } from './schedule-types';

const sortOrderStep = 1000;

type PointerAxis = 'x' | 'y';

const weekdayName = (date: Date): string =>
	new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);

const cardIndexAtPointer = (
	target: HTMLElement,
	event: PointerEvent,
	axis: PointerAxis,
	ignoredMealId?: string
): number => {
	const cards = Array.from(target.querySelectorAll<HTMLElement>('[data-meal-card-id]')).filter(
		(card) => card.dataset.mealCardId !== ignoredMealId
	);
	const pointer = axis === 'x' ? event.clientX : event.clientY;
	const index = cards.findIndex((card) => {
		const rect = card.getBoundingClientRect();
		const midpoint = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
		return pointer < midpoint;
	});
	return index === -1 ? cards.length : index;
};

const timedInsertionIndex = (meals: readonly Meal[], draggedMeal: Meal, date: string): number => {
	if (!draggedMeal.time) return -1;
	const nextDraggedMeal = { ...draggedMeal, date };
	const sortedTargetMeals = sortScheduledMeals([
		...meals.filter((meal) => meal.id !== draggedMeal.id && meal.date === date),
		nextDraggedMeal
	]);
	return sortedTargetMeals.findIndex((meal) => meal.id === draggedMeal.id);
};

const untimedInsertionIndex = (
	meals: readonly Meal[],
	draggedMeal: Meal,
	date: string,
	pointerIndex: number
): number => {
	const timedMealCount = meals.filter(
		(meal) => meal.id !== draggedMeal.id && meal.date === date && meal.time
	).length;
	return Math.max(timedMealCount, pointerIndex);
};

export const dropTargetFromPointer = (
	event: PointerEvent,
	draggedMeal: Meal,
	meals: readonly Meal[]
): MealDropTarget | null => {
	const target = document
		.elementFromPoint(event.clientX, event.clientY)
		?.closest<HTMLElement>('[data-meal-drop-kind]');
	if (!target) return null;
	if (target.dataset.mealDropKind === 'pool') {
		return { kind: 'pool', index: cardIndexAtPointer(target, event, 'x', draggedMeal.id) };
	}
	if (!target.dataset.mealDropDate) return null;
	const date = target.dataset.mealDropDate;
	const timedIndex = timedInsertionIndex(meals, draggedMeal, date);
	const pointerIndex = cardIndexAtPointer(target, event, 'y', draggedMeal.id);
	return {
		kind: 'date',
		date,
		index:
			timedIndex >= 0 ? timedIndex : untimedInsertionIndex(meals, draggedMeal, date, pointerIndex)
	};
};

const assignSortOrders = (nextMeals: Meal[], orderedIds: string[]): Meal[] => {
	const sortOrders = new Map(orderedIds.map((id, index) => [id, (index + 1) * sortOrderStep]));
	return nextMeals.map((meal) =>
		sortOrders.has(meal.id) ? { ...meal, sortOrder: sortOrders.get(meal.id) } : meal
	);
};

const moveToPool = (
	meals: readonly Meal[],
	draggedMeal: Meal,
	target: Extract<MealDropTarget, { kind: 'pool' }>
): Meal[] => {
	const nextMeals = meals.map((meal) =>
		meal.id === draggedMeal.id ? { ...meal, date: undefined, time: undefined } : meal
	);
	const poolMeals = sortMealPool(
		nextMeals.filter(isMealInPool).filter((meal) => meal.id !== draggedMeal.id)
	);
	const insertAt = Math.max(0, Math.min(target.index, poolMeals.length));
	poolMeals.splice(insertAt, 0, { ...draggedMeal, date: undefined, time: undefined });
	return assignSortOrders(
		nextMeals,
		poolMeals.map((meal) => meal.id)
	);
};

const moveToDate = (
	meals: readonly Meal[],
	draggedMeal: Meal,
	target: Extract<MealDropTarget, { kind: 'date' }>
): Meal[] => {
	const targetDate = dateFromKey(target.date);
	let nextMeals = meals.map((meal) =>
		meal.id === draggedMeal.id ? { ...meal, date: target.date, day: weekdayName(targetDate) } : meal
	);
	if (draggedMeal.time) return nextMeals;

	const targetDateMeals = nextMeals
		.filter((meal) => meal.date === target.date && meal.id !== draggedMeal.id)
		.sort(compareScheduledMealOrder);
	const timedMealCount = targetDateMeals.filter((meal) => meal.time).length;
	const untimedMeals = targetDateMeals.filter((meal) => !meal.time).sort(compareMealPoolOrder);
	const insertAt = Math.max(0, Math.min(target.index - timedMealCount, untimedMeals.length));
	untimedMeals.splice(insertAt, 0, {
		...draggedMeal,
		date: target.date,
		day: weekdayName(targetDate)
	});
	nextMeals = assignSortOrders(
		nextMeals,
		untimedMeals.map((meal) => meal.id)
	);
	return nextMeals;
};

export const moveMealToDropTarget = (
	meals: readonly Meal[],
	draggedMeal: Meal,
	target: MealDropTarget
): Meal[] =>
	target.kind === 'pool'
		? moveToPool(meals, draggedMeal, target)
		: moveToDate(meals, draggedMeal, target);
