import type { Meal } from './schedule-types';

const fallbackOrder = 1_000_000;

export const isMealInPool = (meal: Meal): boolean => !meal.date && !meal.time;

export const mealSortOrder = (meal: Meal, fallbackIndex = 0): number =>
	meal.sortOrder ?? fallbackOrder + fallbackIndex;

export const compareMealPoolOrder = (left: Meal, right: Meal): number =>
	mealSortOrder(left) - mealSortOrder(right) || left.title.localeCompare(right.title);

export const compareScheduledMealOrder = (left: Meal, right: Meal): number => {
	if (left.time && right.time) return left.time.localeCompare(right.time);
	if (left.time) return -1;
	if (right.time) return 1;
	return compareMealPoolOrder(left, right);
};

export const sortMealPool = (meals: Meal[]): Meal[] => [...meals].sort(compareMealPoolOrder);
export const sortScheduledMeals = (meals: Meal[]): Meal[] =>
	[...meals].sort(compareScheduledMealOrder);
