import { describe, expect, it } from 'vitest';
import {
	defaultIngredients,
	defaultInstructions,
	instructionPositionDrafts,
	numberText,
	optionalNumber,
	optionalWholeNumber
} from './recipe-editor-model';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

const recipe = (patch: Partial<RecipeMenuItem> = {}): RecipeMenuItem => ({
	id: 'recipe_1',
	title: 'Soup',
	description: '',
	prepTimeMinutes: undefined,
	cookTimeMinutes: undefined,
	yield: undefined,
	ingredients: [],
	instructions: [],
	ingredientCount: 0,
	appliances: [],
	timesCooked: 0,
	reviewSummary: { worthRepeating: 0, neutral: 0, neverAgain: 0, notes: [] },
	plannedCount: 0,
	...patch
});

const ids = () => {
	let index = 0;
	return () => `draft_${++index}`;
};

describe('recipe editor model', () => {
	it('formats optional number text', () => {
		expect(numberText(undefined)).toBe('');
		expect(numberText(12)).toBe('12');
	});

	it('parses optional numbers', () => {
		expect(optionalNumber('')).toBeUndefined();
		expect(optionalNumber(' 2.5 ')).toBe(2.5);
		expect(optionalNumber('nope')).toBeUndefined();
		expect(optionalWholeNumber('2.4')).toBe(2);
		expect(optionalWholeNumber('0')).toBe(1);
	});

	it('creates an empty ingredient row when a recipe has no ingredients', () => {
		expect(defaultIngredients(recipe(), ids())).toEqual([
			{ draftId: 'draft_1', amount: '', unit: '', item: '' }
		]);
	});

	it('normalizes ingredient units and adds draft ids', () => {
		expect(
			defaultIngredients(recipe({ ingredients: [{ amount: '1', item: 'onion' }] }), ids())
		).toEqual([{ draftId: 'draft_1', amount: '1', unit: '', item: 'onion' }]);
	});

	it('sorts instructions and builds position drafts', () => {
		const instructions = defaultInstructions(
			recipe({
				instructions: [
					{ position: 2, text: 'Finish' },
					{ position: 1, text: 'Start' }
				]
			}),
			ids()
		);
		expect(instructions.map((instruction) => instruction.text)).toEqual(['Start', 'Finish']);
		expect(instructionPositionDrafts(instructions)).toEqual({ draft_1: '1', draft_2: '2' });
	});
});
