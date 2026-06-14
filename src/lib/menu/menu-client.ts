import { resolve } from '$app/paths';
import { MENU_RECIPE_PAGE_SIZE } from '$lib/menu/pagination';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

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
	options: { signal?: AbortSignal; limit?: number } = {}
): Promise<RecipeMenuItem[]> => {
	const params = new URLSearchParams({ q: query, limit: String(options.limit ?? 60) });
	const response = await fetch(`${resolve('/menu/recipes')}?${params}`, { signal: options.signal });
	if (!response.ok) throw new Error('Could not search recipes.');
	const body = (await response.json()) as { recipes: RecipeMenuItem[] };
	return body.recipes;
};

export const importRecipeDraftFromUrl = async (url: string): Promise<RecipeMenuItem> => {
	const params = new URLSearchParams({ importUrl: url });
	const response = await fetch(`${resolve('/menu/recipes')}?${params}`);
	if (!response.ok) {
		let message = 'Could not import recipe.';
		try {
			const body = (await response.json()) as { message?: unknown };
			if (typeof body.message === 'string' && body.message.trim()) message = body.message;
		} catch {
			// Fall through to fallback.
		}
		throw new Error(message);
	}
	const body = (await response.json()) as { recipe: RecipeMenuItem };
	return body.recipe;
};
