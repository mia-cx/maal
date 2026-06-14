import { describe, expect, it } from 'vitest';
import { createDraftRecipe } from '$lib/menu/recipe-draft';

describe('createDraftRecipe', () => {
	it('creates a menu recipe draft with stable defaults', () => {
		expect(createDraftRecipe(() => 'abc')).toMatchObject({
			id: 'draft-recipe-abc',
			title: 'New recipe',
			description: '',
			ingredientCount: 0,
			appliances: [],
			timesCooked: 0,
			plannedCount: 0,
			reviewSummary: { worthRepeating: 0, neutral: 0, neverAgain: 0, notes: [] },
			ingredients: [{ amount: '', item: '' }],
			instructions: [{ position: 1, text: '' }]
		});
	});

	it('accepts an explicit title', () => {
		expect(createDraftRecipe(() => 'abc', 'Soup').title).toBe('Soup');
	});
});
