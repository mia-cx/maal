import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recipeTools } from './recipe-tools';
import type { McpContext } from './context';

const mocks = vi.hoisted(() => ({
	deleteUserRecipe: vi.fn(),
	listUserRecipes: vi.fn(),
	resolveHouseholdId: vi.fn(),
	updateUserRecipe: vi.fn()
}));

vi.mock('$lib/server/domains/recipes', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/domains/recipes')>();
	return {
		...actual,
		deleteUserRecipe: mocks.deleteUserRecipe,
		listUserRecipes: mocks.listUserRecipes,
		updateUserRecipe: mocks.updateUserRecipe
	};
});

vi.mock('./context', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./context')>();
	return { ...actual, resolveHouseholdId: mocks.resolveHouseholdId };
});

const context = {
	platform: undefined,
	key: { userId: 'user_1' },
	db: {}
} as McpContext;

const tool = (name: string) => recipeTools.find((candidate) => candidate.name === name);

beforeEach(() => {
	mocks.deleteUserRecipe.mockReset();
	mocks.listUserRecipes.mockReset();
	mocks.resolveHouseholdId.mockReset();
	mocks.updateUserRecipe.mockReset();
	mocks.resolveHouseholdId.mockResolvedValue('household_1');
});

describe('recipeTools', () => {
	it('fetches one extra recipe at the public max limit for pagination lookahead', async () => {
		const recipes = Array.from({ length: 61 }, (_, index) => ({ id: `recipe_${index}` }));
		mocks.listUserRecipes.mockResolvedValue(recipes);

		await expect(tool('list_user_recipes')?.handler(context, { limit: 60, offset: 0 })).resolves.toEqual({
			limit: 60,
			offset: 0,
			nextOffset: 60,
			recipes: recipes.slice(0, 60)
		});
		expect(mocks.listUserRecipes).toHaveBeenCalledWith(expect.objectContaining({ limit: 61 }));
	});

	it('threads resolved household scope into recipe mutations', async () => {
		mocks.updateUserRecipe.mockResolvedValue({ id: 'recipe_1' });
		mocks.deleteUserRecipe.mockResolvedValue({ deleted: true });

		await tool('update_user_recipe')?.handler(context, { recipeId: 'recipe_1', patch: { title: 'Soup' } });
		await tool('delete_user_recipe')?.handler(context, { recipeId: 'recipe_1' });

		expect(mocks.updateUserRecipe).toHaveBeenCalledWith(
			expect.objectContaining({ householdId: 'household_1', recipeId: 'recipe_1' })
		);
		expect(mocks.deleteUserRecipe).toHaveBeenCalledWith(
			expect.objectContaining({ householdId: 'household_1', recipeId: 'recipe_1' })
		);
	});
});
