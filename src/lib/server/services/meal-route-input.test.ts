import { describe, expect, it } from 'vitest';
import type { Meal } from '$lib/plan/plan-types';
import { mealToCreateInput, mealToUpdateInput } from './meal-route-input';

const meal = (overrides: Partial<Meal> = {}): Meal => ({
	id: 'meal_1',
	title: ' Pasta ',
	description: 'Dinner',
	image: 'https://example.test/pasta.jpg',
	prepTimeMinutes: 5,
	cookTimeMinutes: 20,
	servingsPlanned: 3,
	baseServings: 4,
	date: '2026-06-14',
	time: '18:00',
	sortOrder: 2,
	plannedCookWorkosUserId: 'user_2',
	status: 'planned',
	ingredients: ['pasta'],
	instructions: ['boil'],
	...overrides
});

describe('meal route input mapping', () => {
	it('maps custom meals for creation', () => {
		expect(mealToCreateInput(meal(), 'household_1', 'user_1')).toEqual({
			householdId: 'household_1',
			workosUserId: 'user_1',
			userRecipeId: undefined,
			date: '2026-06-14',
			time: '18:00',
			sortOrder: 2,
			plannedCookUserId: 'user_2',
			servingsPlanned: 3,
			customMeal: {
				title: ' Pasta ',
				description: 'Dinner',
				imageUrl: 'https://example.test/pasta.jpg',
				prepTimeMinutes: 5,
				cookTimeMinutes: 20,
				yield: 4,
				ingredients: ['pasta'],
				instructions: ['boil']
			}
		});
	});

	it('omits custom meal details for saved recipe creation', () => {
		expect(
			mealToCreateInput(meal({ userRecipeId: 'recipe_1' }), 'household_1', 'user_1').customMeal
		).toBeUndefined();
	});

	it('maps full updates and falls back to existing cook and status', () => {
		expect(
			mealToUpdateInput(
				meal({ plannedCookWorkosUserId: undefined, status: undefined, title: '  ' }),
				'household_1',
				'user_1',
				{ plannedCookWorkosUserId: 'user_existing', status: 'cooked' },
				2
			).patch
		).toMatchObject({
			plannedCookUserId: 'user_existing',
			status: 'cooked',
			title: 'New meal',
			yield: 4
		});
	});
});
