import type { Meal } from '$lib/components/dashboard/schedule-types';
import type { RecipeMenuItem } from '$lib/components/menu';
import type { UiState } from '$lib/stores/ui-state';
import { getClientDb } from './db';
import { getClientCacheScope, type ClientCacheScope } from './context';
import { householdScopedKey, type CachedPlannedMeal, type CachedRecipe } from './schema';

const localMealIdPrefix = 'local-meal-';
const now = () => Date.now();

const scopeOrActive = (scope?: ClientCacheScope | null) => scope ?? getClientCacheScope();
const isPersistedMeal = (meal: Meal): boolean => !meal.id.startsWith(localMealIdPrefix);

const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneRecipe = (recipe: RecipeMenuItem): RecipeMenuItem => toPlain(recipe);

const cloneMeal = (meal: Meal): Meal => toPlain(meal);

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
	const activeRows = rows.filter((recipe) => !recipe.locallyDeletedAt);
	return {
		recipes: activeRows.filter((recipe) => !recipe.archivedAt).map(cloneRecipe),
		archivedRecipes: activeRows.filter((recipe) => recipe.archivedAt).map(cloneRecipe)
	};
};

export const writeRecipesToDexie = async (
	recipes: readonly RecipeMenuItem[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope || !recipes.length) return;
	const keys = recipes.map((recipe) =>
		householdScopedKey(activeScope.userId, activeScope.householdId, recipe.id)
	);
	const existingRows = await db.recipes.bulkGet(keys);
	const locallyDeletedRecipeIds = new Set(
		existingRows.filter((recipe) => recipe?.locallyDeletedAt).map((recipe) => recipe!.id)
	);
	const recipesToWrite = recipes.filter((recipe) => !locallyDeletedRecipeIds.has(recipe.id));
	if (!recipesToWrite.length) return;
	const cachedAt = now();
	await db.recipes.bulkPut(
		recipesToWrite.map(
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
	const cachedAt = now();
	const keys = recipeIds.map((recipeId) =>
		householdScopedKey(activeScope.userId, activeScope.householdId, recipeId)
	);
	const existingRows = await db.recipes.bulkGet(keys);
	await db.recipes.bulkPut(
		recipeIds.map(
			(recipeId, index) =>
				({
					...(existingRows[index] ?? {
						id: recipeId,
						title: '',
						description: '',
						ingredientCount: 0,
						appliances: [],
						timesCooked: 0,
						plannedCount: 0,
						reviewSummary: { worthRepeating: 0, neutral: 0, neverAgain: 0, notes: [] }
					}),
					key: keys[index],
					userId: activeScope.userId,
					householdId: activeScope.householdId,
					cachedAt,
					locallyDeletedAt: cachedAt
				}) satisfies CachedRecipe
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
	const staleLocalRows = rows.filter((meal) => !isPersistedMeal(meal));
	await db.plannedMeals.bulkDelete(staleLocalRows.map((meal) => meal.key));
	return rows.filter((meal) => isPersistedMeal(meal) && !meal.locallyDeletedAt).map(cloneMeal);
};

export const writeMealsToDexie = async (
	meals: readonly Meal[],
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	const persistedMeals = meals.filter(isPersistedMeal);
	if (!db || !activeScope || !persistedMeals.length) return;
	const keys = persistedMeals.map((meal) =>
		householdScopedKey(activeScope.userId, activeScope.householdId, meal.id)
	);
	const existingRows = await db.plannedMeals.bulkGet(keys);
	const locallyDeletedMealIds = new Set(
		existingRows.filter((meal) => meal?.locallyDeletedAt).map((meal) => meal!.id)
	);
	const mealsToWrite = persistedMeals.filter((meal) => !locallyDeletedMealIds.has(meal.id));
	if (!mealsToWrite.length) return;
	const cachedAt = now();
	await db.plannedMeals.bulkPut(
		mealsToWrite.map(
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

const putDeletedMealTombstone = async ({
	mealId,
	scope,
	cachedAt
}: {
	mealId: string;
	scope: ClientCacheScope;
	cachedAt: number;
}) => {
	const db = getClientDb();
	if (!db) return;
	const key = householdScopedKey(scope.userId, scope.householdId, mealId);
	const existingRow = await db.plannedMeals.get(key);
	await db.plannedMeals.put({
		...(existingRow ?? { id: mealId, title: '' }),
		key,
		userId: scope.userId,
		householdId: scope.householdId,
		cachedAt,
		locallyDeletedAt: cachedAt
	});
};

export const deleteMealFromDexie = async (
	mealId: string,
	scope?: ClientCacheScope | null
): Promise<void> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope) return;
	await putDeletedMealTombstone({ mealId, scope: activeScope, cachedAt: now() });
};

export const deleteMealsForRecipeFromDexie = async (
	recipeIds: readonly string[],
	scope?: ClientCacheScope | null
): Promise<string[]> => {
	const db = getClientDb();
	const activeScope = scopeOrActive(scope);
	if (!db || !activeScope || !recipeIds.length) return [];
	const recipeIdSet = new Set(recipeIds);
	const rows = await db.plannedMeals
		.where('[userId+householdId]')
		.equals([activeScope.userId, activeScope.householdId])
		.toArray();
	const mealIds = rows
		.filter((meal) => meal.userRecipeId && recipeIdSet.has(meal.userRecipeId))
		.map((meal) => meal.id);
	const cachedAt = now();
	await Promise.all(
		mealIds.map((mealId) => putDeletedMealTombstone({ mealId, scope: activeScope, cachedAt }))
	);
	return mealIds;
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
