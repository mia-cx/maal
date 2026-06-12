import { describe, expect, it } from 'vitest';
import {
	canonicalIngredientUnit,
	displayIngredientAmount,
	parseIngredientLine
} from './ingredient-text';

describe('ingredient text units', () => {
	it('recognizes count-like taxonomy units', () => {
		expect(canonicalIngredientUnit('each')).toBe('each');
		expect(canonicalIngredientUnit('pieces')).toBe('piece');
	});

	it('keeps unknown units as source text instead of converting', () => {
		expect(displayIngredientAmount(2, 'knobs', { preferredMassUnit: 'lb' })).toBe('2 knobs');
	});

	it('uses plural unit labels when displaying converted quantities', () => {
		expect(
			displayIngredientAmount(200, 'ml', {
				preferredVolumeUnit: 'tbsp',
				preferredVolumeUnitLabel: 'eetlepel',
				preferredVolumeUnitPluralLabel: 'eetlepels'
			})
		).toBe('13½ eetlepels');
	});

	it('parses count-like units from ingredient lines', () => {
		expect(parseIngredientLine('2 pieces chicken')).toEqual({
			amount: '2',
			unit: 'piece',
			item: 'chicken'
		});
	});

	it('parses Dutch recipe unit aliases from ingredient lines', () => {
		expect(parseIngredientLine('2 el olijfolie')).toEqual({
			amount: '2',
			unit: 'tbsp',
			item: 'olijfolie'
		});
		expect(parseIngredientLine('1 tl komijn')).toEqual({
			amount: '1',
			unit: 'tsp',
			item: 'komijn'
		});
		expect(parseIngredientLine('3 teentjes knoflook')).toEqual({
			amount: '3',
			unit: 'clove',
			item: 'knoflook'
		});
	});
});
