import { describe, expect, it } from 'vitest';
import { displayFoodName, displayIngredient, displayIngredientAmount } from './display';
import type { UnitPreferences } from '$lib/recipes/ingredient-text';

describe('taxonomy display helpers', () => {
	it('renders food aliases by base food id', () => {
		expect(
			displayFoodName('tomatoes', 'tomato', {
				ingredientNameOverrides: { tomatoes: 'pomodori' }
			})
		).toBe('pomodori');
	});

	it('converts base mass quantities to the preferred unit label', () => {
		expect(
			displayIngredientAmount(453.59237, 'grams', {
				preferredMassUnit: 'lb',
				preferredMassUnitLabel: 'pounds'
			})
		).toBe('1 pounds');
	});

	it('converts base volume quantities to the preferred unit label', () => {
		expect(
			displayIngredientAmount(236.5882365, 'milliliters', {
				preferredVolumeUnit: 'cup',
				preferredVolumeUnitLabel: 'cups'
			})
		).toBe('1 cups');
	});

	it('uses food-specific measure overrides before global unit preferences', () => {
		const preferences: UnitPreferences = {
			preferredVolumeUnit: 'cup',
			ingredientUnitOverrides: { vinegar: 'tbsp' },
			ingredientUnitLabelOverrides: { vinegar: 'tablespoons' }
		};

		expect(
			displayIngredientAmount(29.5735295625, 'milliliters', preferences, 'vinegar', 'vinegar')
		).toBe('2 tablespoons');
	});

	it('falls back to original text when canonical quantity is unavailable', () => {
		expect(
			displayIngredient(
				{
					baseQuantity: null,
					baseUnitId: null,
					baseFoodId: null,
					sourceFoodLabel: null,
					originalText: 'a knob of butter'
				},
				{ preferredMassUnit: 'lb' }
			).text
		).toBe('a knob of butter');
	});

	it('keeps source amounts visible when taxonomy base amounts are unavailable', () => {
		expect(
			displayIngredient({
				baseQuantity: null,
				baseUnitId: null,
				baseFoodId: null,
				sourceFoodLabel: 'gerookte-paprikapoeder',
				originalText: '2 el gerookte-paprikapoeder'
			}).text
		).toBe('2 el gerookte-paprikapoeder');
	});
});
