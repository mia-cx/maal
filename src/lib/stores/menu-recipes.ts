import { browser } from '$app/environment';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';
import { createMenuRecipeRemote, readMenuResponseError } from '$lib/menu/menu-client';
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

const removeRecipe = (recipeId: string) => {
	menuRecipesStore.set(menuRecipesStore.get().filter((recipe) => recipe.id !== recipeId));
	if (selectedMenuRecipeIdStore.get() === recipeId) selectedMenuRecipeIdStore.set(null);
};

const removeArchivedRecipe = (recipeId: string) => {
	archivedMenuRecipesStore.set(
		archivedMenuRecipesStore.get().filter((recipe) => recipe.id !== recipeId)
	);
};

const archiveRecipe = (recipe: RecipeMenuItem, archivedAt?: string) => {
	archivedMenuRecipesStore.set([
		{ ...cloneRecipe(recipe), archivedAt: archivedAt ?? recipe.archivedAt },
		...archivedMenuRecipesStore.get().filter((candidate) => candidate.id !== recipe.id)
	]);
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
};

export const appendMenuRecipes = (recipes: RecipeMenuItem[]) => {
	const existingRecipes = menuRecipesStore.get();
	const incomingRecipeIds = new Set(recipes.map((recipe) => recipe.id));
	menuRecipesStore.set([
		...existingRecipes.filter((recipe) => !incomingRecipeIds.has(recipe.id)),
		...cloneRecipes(recipes)
	]);
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
	return recipe;
};

export const updateMenuRecipe = (recipe: RecipeMenuItem) => {
	const previousRecipe = menuRecipesStore.get().find((candidate) => candidate.id === recipe.id);
	replaceRecipe(recipe);
	if (!browser) return;

	fetch(`/menu/recipes/${encodeURIComponent(recipe.id)}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipe })
	})
		.then(async (response) => {
			if (!response.ok) throw new Error(await response.text());
			const body = (await response.json()) as { recipe: RecipeMenuItem };
			replaceRecipe(body.recipe);
		})
		.catch((error: unknown) => {
			console.error('Failed to persist menu recipe', error);
			if (previousRecipe) replaceRecipe(previousRecipe);
		});
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

	const response = await fetch('/menu/recipes', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipeIds })
	});
	if (response.ok) {
		const body = (await response.json()) as { deletedAt?: string };
		archiveRecipes(recipes, body.deletedAt);
		return;
	}

	menuRecipesStore.set(previousRecipes);
	archivedMenuRecipesStore.set(previousArchivedRecipes);
	throw new Error(await readMenuResponseError(response, 'Could not archive recipes.'));
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

	const response = await fetch('/menu/recipes', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipeIds })
	});
	if (response.ok) {
		const body = (await response.json()) as { recipes?: RecipeMenuItem[] };
		const restoredRecipes = body.recipes?.length
			? body.recipes
			: recipes.map((recipe) => ({ ...recipe, archivedAt: undefined }));
		const restoredIds = new Set(restoredRecipes.map((recipe) => recipe.id));
		menuRecipesStore.set([
			...restoredRecipes.map(cloneRecipe),
			...menuRecipesStore.get().filter((candidate) => !restoredIds.has(candidate.id))
		]);
		return restoredRecipes;
	}

	menuRecipesStore.set(previousRecipes);
	archivedMenuRecipesStore.set(previousArchivedRecipes);
	throw new Error(await readMenuResponseError(response, 'Could not restore recipes.'));
};

export const permanentlyDeleteMenuRecipe = async (recipe: RecipeMenuItem) => {
	return permanentlyDeleteMenuRecipes([recipe]);
};

export const permanentlyDeleteMenuRecipes = async (recipes: RecipeMenuItem[]) => {
	if (!recipes.length) return { deletedMealCount: 0 };
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	const recipeIds = recipes.map((recipe) => recipe.id);
	removeArchivedRecipes(recipeIds);
	if (!browser) return { deletedMealCount: 0 };

	const response = await fetch('/menu/recipes', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipeIds, permanent: true })
	});
	if (response.ok) return (await response.json()) as { deletedMealCount: number };

	archivedMenuRecipesStore.set(previousArchivedRecipes);
	throw new Error(await readMenuResponseError(response, 'Could not permanently delete recipes.'));
};
