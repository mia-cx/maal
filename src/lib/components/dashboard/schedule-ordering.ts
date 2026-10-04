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

export const sortMealPool = (meals: readonly Meal[]): Meal[] =>
	[...meals].sort(compareMealPoolOrder);

export const sortOrderForUntimedInsertion = (
	meals: readonly Meal[],
	date: string,
	targetIndex: number
): number => {
	const scheduled = sortScheduledMeals(meals.filter((meal) => meal.date === date));
	const timedCount = scheduled.filter(({ time }) => Boolean(time)).length;
	const untimed = scheduled.filter(({ time }) => !time);
	const insertionIndex = Math.max(0, Math.min(targetIndex - timedCount, untimed.length));
	const previous = untimed[insertionIndex - 1]?.sortOrder;
	const next = untimed[insertionIndex]?.sortOrder;
	if (previous === undefined && next === undefined) return 1000;
	if (previous === undefined) return Math.max(0, (next ?? 1000) - 1000);
	if (next === undefined) return previous + 1000;
	if (next - previous > 1) return previous + Math.floor((next - previous) / 2);
	return (untimed.at(-1)?.sortOrder ?? previous) + 1000;
};
export const sortScheduledMeals = (meals: readonly Meal[]): Meal[] =>
	[...meals].sort(compareScheduledMealOrder);
