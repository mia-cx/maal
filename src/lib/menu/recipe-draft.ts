import { emptyRecipeMenuStats } from '$lib/menu/recipe-defaults';
import type { RecipeMenuItem } from '$lib/menu/menu-types';

export const createDraftRecipe = (
	createId: () => string,
	title = 'New recipe'
): RecipeMenuItem => ({
	id: `draft-recipe-${createId()}`,
	title,
	description: '',
	ingredientCount: 0,
	...emptyRecipeMenuStats(),
	ingredients: [{ amount: '', item: '' }],
	instructions: [{ position: 1, text: '' }]
});
