import { describe, expect, it } from 'vitest';
import { parseRecipeMenuItemPayload } from './recipe-payload';

const validRecipe = {
	id: 'recipe-1',
	title: 'Soup',
	description: '',
	prepTimeMinutes: 0,
	ingredients: [{ amount: '1 cup', unit: 'g', item: 'tomatoes' }],
	instructions: [{ position: 1, text: 'Simmer.' }],
	appliances: ['stovetop'],
	dietTags: ['vegetarian']
};

describe('parseRecipeMenuItemPayload', () => {
	it('accepts a well-formed menu recipe payload', () => {
		expect(parseRecipeMenuItemPayload(validRecipe)).toEqual(validRecipe);
	});

	it('rejects missing identity fields', () => {
		expect(parseRecipeMenuItemPayload({ ...validRecipe, id: '' })).toBeUndefined();
		expect(parseRecipeMenuItemPayload({ ...validRecipe, title: '' })).toBeUndefined();
	});

	it('rejects malformed nested ingredient and instruction fields', () => {
		expect(
			parseRecipeMenuItemPayload({
				...validRecipe,
				ingredients: [{ amount: 1, item: 'tomatoes' }]
			})
		).toBeUndefined();
		expect(
			parseRecipeMenuItemPayload({
				...validRecipe,
				instructions: [{ position: 0, text: 'Nope.' }]
			})
		).toBeUndefined();
	});

	it('rejects malformed optional scalars and tag arrays', () => {
		expect(
			parseRecipeMenuItemPayload({ ...validRecipe, cookTimeMinutes: Number.NaN })
		).toBeUndefined();
		expect(parseRecipeMenuItemPayload({ ...validRecipe, dietTags: ['ok', 42] })).toBeUndefined();
	});
});
