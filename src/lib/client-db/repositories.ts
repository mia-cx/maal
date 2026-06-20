import type { Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';
import type { UiState } from '$lib/stores/ui-state';
import { getClientDb } from './db';
import { getClientCacheScope, type ClientCacheScope } from './context';
import { householdScopedKey, type CachedPlannedMeal, type CachedRecipe } from './schema';

const now = () => Date.now();

const scopeOrActive = (scope?: ClientCacheScope | null) => scope ?? getClientCacheScope();

const cloneRecipe = (recipe: RecipeMenuItem): RecipeMenuItem => ({
	...recipe,
	ingredients: recipe.ingredients?.map((ingredient) => ({ ...ingredient })),
	instructions: recipe.instructions?.map((instruction) => ({ ...instruction })),
	reviewSummary: recipe.reviewSummary
		? { ...recipe.reviewSummary, notes: [...recipe.reviewSummary.notes] }
		: recipe.reviewSummary
});

const cloneMeal = (meal: Meal): Meal => ({
	...meal,
	ingredients: meal.ingredients ? [...meal.ingredients] : undefined,
	instructions: meal.instructions ? [...meal.instructions] : undefined
});

export const readRecipesFromDexie = async (
	scope?: ClientCacheScope | null
): Promise<{ recipes: RecipeMenuItem[]; archivedRecipes: RecipeMenuItem[] }> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope) return { recipes: [], archivedRecipes: [] };
	const rows = await db.recipes
		.where('[userId+householdId]')
		.equals([activeScope.userId, activeScope.householdId])
		.toArray();
	return {
		recipes: rows.filter((recipe) => !recipe.archivedAt).map(cloneRecipe),
		archivedRecipes: rows.filter((recipe) => recipe.archivedAt).map(cloneRecipe)
	};
};

export const writeRecipesToDexie = async (
	recipes: readonly RecipeMenuItem[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope || !recipes.length) return;
	const cachedAt = now();
	await db.recipes.bulkPut(
		recipes.map(
			(recipe) =>
				({
					...cloneRecipe(recipe),
					key: householdScopedKey(activeScope.userId, activeScope.householdId, recipe.id),
					userId: activeScope.userId,
					householdId: activeScope.householdId,
					cachedAt
				}) satisfies CachedRecipe
		)
	);
};

export const deleteRecipesFromDexie = async (
	recipeIds: readonly string[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope || !recipeIds.length) return;
	await db.recipes.bulkDelete(
		recipeIds.map((recipeId) =>
			householdScopedKey(activeScope.userId, activeScope.householdId, recipeId)
		)
	);
};

export const searchRecipesInDexie = async (
	query: string,
	limit = 60,
	scope?: ClientCacheScope | null
): Promise<RecipeMenuItem[]> => {
	const normalized = query.trim().toLowerCase();
	const { recipes } = await readRecipesFromDexie(scope);
	const matches = normalized
		? recipes.filter((recipe) =>
				[
					recipe.title,
					recipe.description,
					recipe.sourceSiteName,
					recipe.sourceAuthorName,
					recipe.ingredients?.map((ingredient) => ingredient.item).join(' ')
				]
					.filter(Boolean)
					.join(' ')
					.toLowerCase()
					.includes(normalized)
			)
		: recipes;
	return matches.slice(0, limit).map(cloneRecipe);
};

export const readMealsFromDexie = async (scope?: ClientCacheScope | null): Promise<Meal[]> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope) return [];
	const rows = await db.plannedMeals
		.where('[userId+householdId]')
		.equals([activeScope.userId, activeScope.householdId])
		.toArray();
	return rows.map(cloneMeal);
};

export const writeMealsToDexie = async (
	meals: readonly Meal[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope || !meals.length) return;
	const cachedAt = now();
	await db.plannedMeals.bulkPut(
		meals.map(
			(meal) =>
				({
					...cloneMeal(meal),
					key: householdScopedKey(activeScope.userId, activeScope.householdId, meal.id),
					userId: activeScope.userId,
					householdId: activeScope.householdId,
					cachedAt
				}) satisfies CachedPlannedMeal
		)
	);
};

export const deleteMealFromDexie = async (
	mealId: string,
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope) return;
	await db.plannedMeals.delete(
		householdScopedKey(activeScope.userId, activeScope.householdId, mealId)
	);
};

export const readUiStateFromDexie = async (
	key: string,
	scope?: ClientCacheScope | null
): Promise<Partial<UiState> | null> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope) return null;
	const entry = await db.uiStates.get(
		householdScopedKey(activeScope.userId, activeScope.householdId, key)
	);
	return entry?.state ?? null;
};

export const writeUiStateToDexie = async (
	key: string,
	state: Partial<UiState>,
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope) return;
	await db.uiStates.put({
		key: householdScopedKey(activeScope.userId, activeScope.householdId, key),
		userId: activeScope.userId,
		householdId: activeScope.householdId,
		name: key,
		state,
		updatedAt: now()
	});
};
