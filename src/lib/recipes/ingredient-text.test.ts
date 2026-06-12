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

	it('parses count-like units from ingredient lines', () => {
		expect(parseIngredientLine('2 pieces chicken')).toEqual({
			amount: '2',
			unit: 'piece',
			item: 'chicken'
		});
	});
});
