import { resolve } from '$app/paths';
import { MENU_RECIPE_PAGE_SIZE } from '$lib/menu/pagination';
import type { RecipeMenuItem } from '$lib/menu/menu-types';

export const readMenuResponseError = async (
	response: Response,
	fallback: string
): Promise<string> => {
	try {
		const body = (await response.json()) as { message?: unknown };
		if (typeof body.message === 'string' && body.message.trim()) return body.message;
	} catch {
		// Fall through to fallback.
	}
	return fallback;
};

export const fetchMenuRecipesPage = async (
	offset: number,
	limit = MENU_RECIPE_PAGE_SIZE
): Promise<{ recipes: RecipeMenuItem[]; nextRecipeOffset: number | null }> => {
	const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
	const response = await fetch(`${resolve('/menu/recipes')}?${params}`);
	if (!response.ok) throw new Error('Could not load more recipes.');
	return (await response.json()) as { recipes: RecipeMenuItem[]; nextRecipeOffset: number | null };
};

export const searchMenuRecipes = async (
	query: string,
	options: { signal?: AbortSignal; limit?: number; picker?: 'meal' } = {}
): Promise<RecipeMenuItem[]> => {
	const params = new URLSearchParams({ q: query, limit: String(options.limit ?? 60) });
	if (options.picker) params.set('picker', options.picker);
	const response = await fetch(`${resolve('/menu/recipes')}?${params}`, { signal: options.signal });
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not search recipes.'));
	const body = (await response.json()) as { recipes: RecipeMenuItem[] };
	return body.recipes;
};

export const fetchRecipePickerRecipes = async (limit = 60): Promise<RecipeMenuItem[]> => {
	const params = new URLSearchParams({ picker: 'meal', limit: String(limit) });
	const response = await fetch(`${resolve('/menu/recipes')}?${params}`);
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not load recipes.'));
	const body = (await response.json()) as { recipes: RecipeMenuItem[] };
	return body.recipes;
};

export const importRecipeDraftFromUrl = async (url: string): Promise<RecipeMenuItem> => {
	const params = new URLSearchParams({ importUrl: url });
	const response = await fetch(`${resolve('/menu/recipes')}?${params}`);
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not import recipe.'));
	const body = (await response.json()) as { recipe: RecipeMenuItem };
	return body.recipe;
};

export const createMenuRecipeRemote = async (input: {
	title?: string;
	url?: string;
	recipe?: RecipeMenuItem;
}): Promise<RecipeMenuItem> => {
	const response = await fetch('/menu/recipes', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not create recipe.'));
	const body = (await response.json()) as { recipe: RecipeMenuItem };
	return body.recipe;
};

export const updateMenuRecipeRemote = async (recipe: RecipeMenuItem): Promise<RecipeMenuItem> => {
	const response = await fetch(`/menu/recipes/${encodeURIComponent(recipe.id)}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipe })
	});
	if (!response.ok) throw new Error(await response.text());
	const body = (await response.json()) as { recipe: RecipeMenuItem };
	return body.recipe;
};

export const archiveMenuRecipesRemote = async (
	recipeIds: string[]
): Promise<{ deletedAt?: string }> => {
	const response = await fetch('/menu/recipes', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipeIds })
	});
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not archive recipes.'));
	return (await response.json()) as { deletedAt?: string };
};

export const restoreMenuRecipesRemote = async (recipeIds: string[]): Promise<RecipeMenuItem[]> => {
	const response = await fetch('/menu/recipes', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipeIds })
	});
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not restore recipes.'));
	const body = (await response.json()) as { recipes?: RecipeMenuItem[] };
	return body.recipes ?? [];
};

export const permanentlyDeleteMenuRecipesRemote = async (
	recipeIds: string[]
): Promise<{ deletedMealCount: number }> => {
	const response = await fetch('/menu/recipes', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipeIds, permanent: true })
	});
	if (!response.ok)
		throw new Error(await readMenuResponseError(response, 'Could not permanently delete recipes.'));
	return (await response.json()) as { deletedMealCount: number };
};
