import { describe, expect, it } from 'vitest';
import {
	canonicalIngredientUnit,
	convertInstructionTemperatures,
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

	it('converts instruction temperatures to the preferred unit', () => {
		expect(
			convertInstructionTemperatures('Preheat to 400°F, then cook at 350F. Finish at 375ºF.', {
				preferredTemperatureUnit: 'celsius',
				preferredTemperatureUnitLabel: '°C',
				unitConversions: {
					celsius: { baseUnitId: 'celsius', toBaseFactor: 1, toBaseOffset: 0 },
					fahrenheit: {
						baseUnitId: 'celsius',
						toBaseFactor: 0.555555555555556,
						toBaseOffset: -17.7777777777778
					}
				},
				unitAliases: { '°F': 'fahrenheit', f: 'fahrenheit', '°C': 'celsius', c: 'celsius' }
			})
		).toBe('Preheat to 205°C, then cook at 175°C. Finish at 190°C.');
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
