import { describe, expect, it } from 'vitest';
import { mealIngredientLineToSidecar, mealInstructionLineToSidecar } from './meal-line-sidecars';

describe('meal line sidecars', () => {
	it('maps ingredient text into parsed meal ingredient fields', () => {
		expect(mealIngredientLineToSidecar('meal_1', '2 cups flour', 3)).toMatchObject({
			householdMealId: 'meal_1',
			lineIndex: 3,
			originalText: '2 cups flour',
			sourceAmountText: '2',
			sourceQuantity: 2,
			sourceUnitLabel: undefined,
			sourceFoodLabel: 'flour',
			confidence: 1
		});
	});

	it('falls back to original ingredient text when no item is parsed', () => {
		expect(mealIngredientLineToSidecar('meal_1', 'salt', 0)).toMatchObject({
			originalText: 'salt',
			sourceAmountText: null,
			sourceQuantity: undefined,
			sourceUnitLabel: undefined,
			sourceFoodLabel: 'salt'
		});
	});

	it('maps instruction text into meal instruction fields', () => {
		expect(mealInstructionLineToSidecar('meal_1', 'Bake until golden.', 2)).toEqual({
			householdMealId: 'meal_1',
			stepIndex: 2,
			text: 'Bake until golden.',
			confidence: 1
		});
	});
});
