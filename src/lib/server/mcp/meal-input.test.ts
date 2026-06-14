import { describe, expect, it } from 'vitest';
import {
	mealFailureLabel,
	mealPatchFromArgs,
	recipeFromArgs,
	recipePatchFromArgs
} from './meal-input';

describe('MCP meal input mapping', () => {
	it('maps recipe args into recipe menu content', () => {
		expect(
			recipeFromArgs({
				title: ' Soup ',
				description: 'Nice',
				prepTimeMinutes: '10',
				cookTimeMinutes: 20,
				yield: '4',
				ingredients: ['onion', 3, 'stock'],
				instructions: ['Chop', 'Simmer'],
				userNotes: 'Use leftovers'
			})
		).toMatchObject({
			title: 'Soup',
			description: 'Nice',
			prepTimeMinutes: 10,
			cookTimeMinutes: 20,
			yield: 4,
			ingredients: [
				{ amount: '', item: 'onion' },
				{ amount: '', item: 'stock' }
			],
			instructions: [
				{ position: 0, text: 'Chop' },
				{ position: 1, text: 'Simmer' }
			],
			userNotes: 'Use leftovers'
		});
	});

	it('leaves omitted recipe patch fields undefined', () => {
		expect(recipePatchFromArgs({ title: ' Soup ', ingredients: ['onion'] })).toEqual(
			expect.objectContaining({
				title: 'Soup',
				description: undefined,
				ingredients: [{ amount: '', item: 'onion' }],
				instructions: undefined
			})
		);
	});

	it('maps nullable meal patch fields', () => {
		expect(
			mealPatchFromArgs({
				date: null,
				time: '18:00',
				sortOrder: null,
				plannedCookUserId: null,
				servingsPlanned: '3',
				status: 'cooked',
				description: null,
				cookTimeMinutes: null,
				ingredients: ['rice'],
				instructions: ['boil']
			})
		).toEqual({
			date: null,
			time: '18:00',
			sortOrder: null,
			plannedCookUserId: null,
			servingsPlanned: 3,
			status: 'cooked',
			title: undefined,
			description: null,
			cookTimeMinutes: null,
			ingredients: ['rice'],
			instructions: ['boil']
		});
	});

	it('uses the best available failure label', () => {
		expect(mealFailureLabel({ title: 'Dinner' }, 0)).toBe('Dinner');
		expect(mealFailureLabel({ customMeal: { title: 'Custom' } }, 0)).toBe('Custom');
		expect(mealFailureLabel({ url: 'https://example.com' }, 0)).toBe('https://example.com');
		expect(mealFailureLabel({}, 2)).toBe('Meal 3');
	});
});
