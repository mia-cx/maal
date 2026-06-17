import type { Meal } from '$lib/plan/plan-types';
import { normalizeServingsPlanned } from './planned-servings';
import type { CreateHouseholdMealInput, UpdateHouseholdMealInput } from './meal-plan';

type ExistingMeal = {
	status: NonNullable<Meal['status']>;
	plannedCookWorkosUserId: string | null;
};

export const mealToCreateInput = (
	meal: Meal,
	householdId: string,
	workosUserId: string
): CreateHouseholdMealInput => ({
	householdId,
	workosUserId,
	userRecipeId: meal.userRecipeId,
	date: meal.date,
	time: meal.time,
	sortOrder: meal.sortOrder,
	plannedCookUserId: meal.plannedCookWorkosUserId,
	servingsPlanned: meal.servingsPlanned,
	customMeal: meal.userRecipeId
		? undefined
		: {
				title: meal.title,
				description: meal.description,
				imageUrl: meal.image,
				prepTimeMinutes: meal.prepTimeMinutes,
				cookTimeMinutes: meal.cookTimeMinutes,
				yield: meal.baseServings,
				ingredients: meal.ingredients,
				instructions: meal.instructions
			}
});

export const mealToUpdateInput = (
	meal: Meal,
	householdId: string,
	workosUserId: string,
	existingMeal: ExistingMeal,
	defaultServings: number
): UpdateHouseholdMealInput => ({
	householdId,
	workosUserId,
	mealId: meal.id,
	patch: {
		date: meal.date ?? null,
		time: meal.time ?? null,
		sortOrder: meal.sortOrder ?? null,
		plannedCookUserId: meal.plannedCookWorkosUserId ?? existingMeal.plannedCookWorkosUserId,
		servingsPlanned: meal.servingsPlanned,
		status: meal.status ?? existingMeal.status,
		title: meal.title.trim() || 'New meal',
		description: meal.description ?? null,
		imageUrl: meal.image ?? null,
		prepTimeMinutes: meal.prepTimeMinutes ?? null,
		cookTimeMinutes: meal.cookTimeMinutes ?? null,
		yield: meal.baseServings ?? normalizeServingsPlanned(meal, defaultServings),
		ingredients: meal.ingredients,
		instructions: meal.instructions
	}
});
