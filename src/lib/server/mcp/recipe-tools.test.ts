import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recipeTools } from './recipe-tools';
import type { McpContext } from './context';

const mocks = vi.hoisted(() => ({
	listUserRecipes: vi.fn(),
	resolveHouseholdId: vi.fn()
}));

vi.mock('$lib/server/domains/recipes', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/domains/recipes')>();
	return { ...actual, listUserRecipes: mocks.listUserRecipes };
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

const listUserRecipesTool = recipeTools.find((tool) => tool.name === 'list_user_recipes');

beforeEach(() => {
	mocks.listUserRecipes.mockReset();
	mocks.resolveHouseholdId.mockReset();
	mocks.resolveHouseholdId.mockResolvedValue('household_1');
});

describe('recipeTools', () => {
	it('fetches one extra recipe at the public max limit for pagination lookahead', async () => {
		const recipes = Array.from({ length: 61 }, (_, index) => ({ id: `recipe_${index}` }));
		mocks.listUserRecipes.mockResolvedValue(recipes);

		await expect(listUserRecipesTool?.handler(context, { limit: 60, offset: 0 })).resolves.toEqual({
			limit: 60,
			offset: 0,
			nextOffset: 60,
			recipes: recipes.slice(0, 60)
		});
		expect(mocks.listUserRecipes).toHaveBeenCalledWith(expect.objectContaining({ limit: 61 }));
	});
});
