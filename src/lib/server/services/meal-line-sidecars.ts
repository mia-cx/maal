import type { householdMealIngredients, householdMealInstructions } from '$lib/server/db/schema';
import { parseIngredientAmount, parseIngredientLine } from '$lib/recipes/ingredient-text';

export const mealIngredientLineToSidecar = (
	householdMealId: string,
	line: string,
	lineIndex: number
): typeof householdMealIngredients.$inferInsert => {
	const parsed = parseIngredientLine(line);
	const amount = parseIngredientAmount(parsed.amount);
	return {
		householdMealId,
		lineIndex,
		originalText: line,
		sourceAmountText: parsed.amount || null,
		sourceQuantity: amount.quantity,
		sourceUnitLabel: amount.unit,
		sourceFoodLabel: parsed.item || line,
		confidence: 1
	};
};

export const mealInstructionLineToSidecar = (
	householdMealId: string,
	text: string,
	stepIndex: number
): typeof householdMealInstructions.$inferInsert => ({
	householdMealId,
	stepIndex,
	text,
	confidence: 1
});
