import { browser } from '$app/environment';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';
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

const readResponseError = async (response: Response, fallback: string): Promise<string> => {
	try {
		const body = (await response.json()) as { message?: unknown };
		if (typeof body.message === 'string' && body.message.trim()) return body.message;
	} catch {
		// Fall through to the generic message.
	}
	return fallback;
};

export const createMenuRecipe = async (input: {
	title?: string;
	url?: string;
	recipe?: RecipeMenuItem;
}) => {
	if (!browser) throw new Error('Recipe creation requires a browser session.');
	const response = await fetch('/menu/recipes', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!response.ok) throw new Error(await readResponseError(response, 'Could not create recipe.'));
	const body = (await response.json()) as { recipe: RecipeMenuItem };
	const recipes = menuRecipesStore.get();
	menuRecipesStore.set([
		...recipes.filter((recipe) => recipe.id !== body.recipe.id),
		cloneRecipe(body.recipe)
	]);
	return body.recipe;
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
	const previousRecipes = menuRecipesStore.get();
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	removeRecipe(recipe.id);
	if (!browser) return;

	const response = await fetch(`/menu/recipes/${encodeURIComponent(recipe.id)}`, {
		method: 'DELETE'
	});
	if (response.ok) {
		const body = (await response.json()) as { deletedAt?: string };
		archiveRecipe(recipe, body.deletedAt);
		return;
	}

	menuRecipesStore.set(previousRecipes);
	archivedMenuRecipesStore.set(previousArchivedRecipes);
	throw new Error(await readResponseError(response, 'Could not archive recipe.'));
};

export const restoreMenuRecipe = async (recipe: RecipeMenuItem) => {
	const previousRecipes = menuRecipesStore.get();
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	removeArchivedRecipe(recipe.id);
	if (!browser) return;

	const response = await fetch(`/menu/recipes/${encodeURIComponent(recipe.id)}`, {
		method: 'PATCH'
	});
	if (response.ok) {
		const body = (await response.json()) as { recipe?: RecipeMenuItem };
		const restoredRecipe = body.recipe ?? { ...recipe, archivedAt: undefined };
		menuRecipesStore.set([
			cloneRecipe(restoredRecipe),
			...menuRecipesStore.get().filter((candidate) => candidate.id !== recipe.id)
		]);
		return restoredRecipe;
	}

	menuRecipesStore.set(previousRecipes);
	archivedMenuRecipesStore.set(previousArchivedRecipes);
	throw new Error(await readResponseError(response, 'Could not restore recipe.'));
};

export const permanentlyDeleteMenuRecipe = async (recipe: RecipeMenuItem) => {
	const previousArchivedRecipes = archivedMenuRecipesStore.get();
	removeArchivedRecipe(recipe.id);
	if (!browser) return { deletedMealCount: 0 };

	const response = await fetch(`/menu/recipes/${encodeURIComponent(recipe.id)}?permanent=true`, {
		method: 'DELETE'
	});
	if (response.ok) return (await response.json()) as { deletedMealCount: number };

	archivedMenuRecipesStore.set(previousArchivedRecipes);
	throw new Error(await readResponseError(response, 'Could not permanently delete recipe.'));
};
