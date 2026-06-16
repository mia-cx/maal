import type { HouseholdMember, Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';

export type PlanRouteCacheEntry = {
	meals: Meal[];
	householdMembers: HouseholdMember[];
};

export type MenuRouteCacheEntry = {
	recipes: RecipeMenuItem[];
	archivedRecipes: RecipeMenuItem[];
	nextRecipeOffset: number | null;
};

const planCache = new Map<string, PlanRouteCacheEntry>();
const menuCache = new Map<string, MenuRouteCacheEntry>();

const cloneMeal = (meal: Meal): Meal => ({
	...meal,
	ingredients: meal.ingredients ? [...meal.ingredients] : undefined,
	instructions: meal.instructions ? [...meal.instructions] : undefined
});

const cloneRecipe = (recipe: RecipeMenuItem): RecipeMenuItem => ({
	...recipe,
	ingredients: recipe.ingredients
		? recipe.ingredients.map((ingredient) => ({ ...ingredient }))
		: undefined,
	instructions: recipe.instructions
		? recipe.instructions.map((instruction) => ({ ...instruction }))
		: undefined
});

const clonePlanEntry = (entry: PlanRouteCacheEntry): PlanRouteCacheEntry => ({
	meals: entry.meals.map(cloneMeal),
	householdMembers: entry.householdMembers.map((member) => ({ ...member }))
});

const cloneMenuEntry = (entry: MenuRouteCacheEntry): MenuRouteCacheEntry => ({
	recipes: entry.recipes.map(cloneRecipe),
	archivedRecipes: entry.archivedRecipes.map(cloneRecipe),
	nextRecipeOffset: entry.nextRecipeOffset
});

export const getCachedPlanRouteData = (householdId: string | null): PlanRouteCacheEntry | null => {
	if (!householdId) return null;
	const entry = planCache.get(householdId);
	return entry ? clonePlanEntry(entry) : null;
};

export const setCachedPlanRouteData = (
	householdId: string | null,
	entry: PlanRouteCacheEntry
): void => {
	if (!householdId) return;
	planCache.set(householdId, clonePlanEntry(entry));
};

export const getCachedMenuRouteData = (householdId: string | null): MenuRouteCacheEntry | null => {
	if (!householdId) return null;
	const entry = menuCache.get(householdId);
	return entry ? cloneMenuEntry(entry) : null;
};

export const setCachedMenuRouteData = (
	householdId: string | null,
	entry: MenuRouteCacheEntry
): void => {
	if (!householdId) return;
	menuCache.set(householdId, cloneMenuEntry(entry));
};
