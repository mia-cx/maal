import { describe, expect, it } from 'vitest';
import { createBatchHouseholdMeals } from './batch-meal-handler';
import type { McpContext } from './context';

const context = {
	platform: undefined,
	key: { userId: 'user_1' },
	db: {}
} as McpContext;

describe('createBatchHouseholdMeals', () => {
	it('preserves tool error messages for per-item validation failures', async () => {
		await expect(
			createBatchHouseholdMeals(context, 'household_1', {
				meals: [{ url: 'https://example.com/recipe', userRecipeId: 'recipe_1' }]
			})
		).resolves.toMatchObject({
			created: [],
			errors: [
				{
					index: 0,
					message: 'Pass exactly one meal source: url, userRecipeId, recipe, or customMeal.'
				}
			]
		});
	});
});
