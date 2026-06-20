import { browser } from '$app/environment';
import {
	deleteRecipesFromDexie,
	readRecipesFromDexie,
	writeRecipesToDexie
} from '$lib/client-db/repositories';
import type { RecipeMenuItem } from '$lib/menu/menu-types';
import {
	archiveMenuRecipesRemote,
	createMenuRecipeRemote,
	permanentlyDeleteMenuRecipesRemote,
	restoreMenuRecipesRemote,
	updateMenuRecipeRemote
} from '$lib/menu/menu-client';
import { atom, computed } from 'nanostores';

const cloneRecipe = (recipe: RecipeMenuItem): RecipeMenuItem => ({
	...recipe,
	ingredients: recipe.ingredients?.map((ingredient) => ({ ...ingredient })),
	instructions: recipe.instructions?.map((instruction) => ({ ...instruction })),
	reviewSummary: {
		...recipe.reviewSummary,
		notes: [...recipe.reviewSummary.notes]
	}
});

const cloneRecipes = (recipes: RecipeMenuItem[]): RecipeMenuItem[] => recipes.map(cloneRecipe);

export type MenuRecipeStoreSnapshot = {
	recipes: RecipeMenuItem[];
	archivedRecipes: RecipeMenuItem[];
	selectedRecipeId: string | null;
};

export const menuRecipesStore = atom<RecipeMenuItem[]>([]);
export const archivedMenuRecipesStore = atom<RecipeMenuItem[]>([]);
export const selectedMenuRecipeIdStore = atom<string | null>(null);
export const selectedMenuRecipeStore = computed(
	[menuRecipesStore, selectedMenuRecipeIdStore],
	(recipes, selectedRecipeId) =>
		selectedRecipeId ? (recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null) : null
);

const replaceRecipe = (recipe: RecipeMenuItem) => {
	menuRecipesStore.set(
		menuRecipesStore
			.get()
			.map((candidate) => (candidate.id === recipe.id ? cloneRecipe(recipe) : candidate))
	);
};

const removeRecipes = (recipeIds: string[]) => {
	const idSet = new Set(recipeIds);
	menuRecipesStore.set(menuRecipesStore.get().filter((recipe) => !idSet.has(recipe.id)));
	if (selectedMenuRecipeIdStore.get() && idSet.has(selectedMenuRecipeIdStore.get()!)) {
		selectedMenuRecipeIdStore.set(null);
	}
};

const removeArchivedRecipes = (recipeIds: string[]) => {
	const idSet = new Set(recipeIds);
	archivedMenuRecipesStore.set(
		archivedMenuRecipesStore.get().filter((recipe) => !idSet.has(recipe.id))
	);
};

const archiveRecipes = (recipes: RecipeMenuItem[], archivedAt?: string) => {
	const recipeIds = new Set(recipes.map((recipe) => recipe.id));
	archivedMenuRecipesStore.set([
		...recipes.map((recipe) => ({
			...cloneRecipe(recipe),
			archivedAt: archivedAt ?? recipe.archivedAt
		})),
		...archivedMenuRecipesStore.get().filter((candidate) => !recipeIds.has(candidate.id))
	]);
};

export const hydrateMenuRecipes = (
	recipes: RecipeMenuItem[],
	archivedRecipes?: RecipeMenuItem[]
) => {
	menuRecipesStore.set(cloneRecipes(recipes));
	if (archivedRecipes) archivedMenuRecipesStore.set(cloneRecipes(archivedRecipes));
	void writeRecipesToDexie(archivedRecipes ? [...recipes, ...archivedRecipes] : recipes);
};

export const hydrateMenuRecipesFromDexie = async () => {
	const cached = await readRecipesFromDexie();
	if (!cached.recipes.length && !cached.archivedRecipes.length) return cached;
	hydrateMenuRecipes(cached.recipes, cached.archivedRecipes);
	return cached;
};

export const appendMenuRecipes = (recipes: RecipeMenuItem[]) => {
	const existingRecipes = menuRecipesStore.get();
	const incomingRecipeIds = new Set(recipes.map((recipe) => recipe.id));
	menuRecipesStore.set([
		...existingRecipes.filter((recipe) => !incomingRecipeIds.has(recipe.id)),
		...cloneRecipes(recipes)
	]);
	void writeRecipesToDexie(recipes);
};

export const selectMenuRecipe = (recipeId: string | null) => {
	selectedMenuRecipeIdStore.set(recipeId);
};

export const createMenuRecipe = async (input: {
	title?: string;
	url?: string;
	recipe?: RecipeMenuItem;
}) => {
	if (!browser) throw new Error('Recipe creation requires a browser session.');
	const recipe = await createMenuRecipeRemote(input);
	const recipes = menuRecipesStore.get();
	menuRecipesStore.set([
		...recipes.filter((candidate) => candidate.id !== recipe.id),
		cloneRecipe(recipe)
	]);
	void writeRecipesToDexie([recipe]);
	return recipe;
};

export const updateMenuRecipe = async (recipe: RecipeMenuItem) => {
	const previousRecipe = menuRecipesStore.get().find((candidate) => candidate.id === recipe.id);
	replaceRecipe(recipe);
	if (!browser) return recipe;

	try {
		const persistedRecipe = await updateMenuRecipeRemote(recipe);
		replaceRecipe(persistedRecipe);
		void writeRecipesToDexie([persistedRecipe]);
		return persistedRecipe;
	} catch (error) {
		if (previousRecipe) replaceRecipe(previousRecipe);
		throw error;
	}
};

export const deleteMenuRecipe = async (recipe: RecipeMenuItem) => {
	await deleteMenuRecipes([recipe]);
};

export const deleteMenuRecipes = async (recipes: RecipeMenuItem[]) => {
	if (!recipes.length) return;
	const previousRecipes = menuRecipesStore.get();
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	const recipeIds = recipes.map((recipe) => recipe.id);
	removeRecipes(recipeIds);
	if (!browser) return;

	try {
		const body = await archiveMenuRecipesRemote(recipeIds);
		archiveRecipes(recipes, body.deletedAt);
		void writeRecipesToDexie(
			recipes.map((recipe) => ({ ...recipe, archivedAt: body.deletedAt ?? recipe.archivedAt }))
		);
	} catch (error) {
		menuRecipesStore.set(previousRecipes);
		archivedMenuRecipesStore.set(previousArchivedRecipes);
		throw error;
	}
};

export const restoreMenuRecipe = async (recipe: RecipeMenuItem) => {
	return (await restoreMenuRecipes([recipe]))[0];
};

export const restoreMenuRecipes = async (recipes: RecipeMenuItem[]) => {
	if (!recipes.length) return [];
	const previousRecipes = menuRecipesStore.get();
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	const recipeIds = recipes.map((recipe) => recipe.id);
	removeArchivedRecipes(recipeIds);
	if (!browser) return [];

	try {
		const remoteRecipes = await restoreMenuRecipesRemote(recipeIds);
		const restoredRecipes = remoteRecipes.length
			? remoteRecipes
			: recipes.map((recipe) => ({ ...recipe, archivedAt: undefined }));
		const restoredIds = new Set(restoredRecipes.map((recipe) => recipe.id));
		menuRecipesStore.set([
			...restoredRecipes.map(cloneRecipe),
			...menuRecipesStore.get().filter((candidate) => !restoredIds.has(candidate.id))
		]);
		void writeRecipesToDexie(restoredRecipes);
		return restoredRecipes;
	} catch (error) {
		menuRecipesStore.set(previousRecipes);
		archivedMenuRecipesStore.set(previousArchivedRecipes);
		throw error;
	}
};

export const permanentlyDeleteMenuRecipe = async (recipe: RecipeMenuItem) => {
	return permanentlyDeleteMenuRecipes([recipe]);
};

export const permanentlyDeleteMenuRecipes = async (recipes: RecipeMenuItem[]) => {
	if (!recipes.length) return { deletedMealCount: 0 };
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	const recipeIds = recipes.map((recipe) => recipe.id);
	removeArchivedRecipes(recipeIds);
	void deleteRecipesFromDexie(recipeIds);
	if (!browser) return { deletedMealCount: 0 };

	try {
		return await permanentlyDeleteMenuRecipesRemote(recipeIds);
	} catch (error) {
		archivedMenuRecipesStore.set(previousArchivedRecipes);
		throw error;
	}
};
