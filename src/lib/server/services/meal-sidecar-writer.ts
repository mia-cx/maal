import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { householdMealIngredients, householdMealInstructions } from '$lib/server/db/schema';
import { insertHouseholdMealInstructionEvents } from '$lib/server/taxonomy/instruction-events';
import { mealIngredientLineToSidecar, mealInstructionLineToSidecar } from './meal-line-sidecars';

type Db = ReturnType<typeof getDb>;

export const replaceMealIngredientsFromLines = async (
	db: Db,
	householdMealId: string,
	ingredients: string[] = []
) => {
	await db
		.delete(householdMealIngredients)
		.where(eq(householdMealIngredients.householdMealId, householdMealId));
	for (const [index, line] of ingredients.entries()) {
		await db
			.insert(householdMealIngredients)
			.values(mealIngredientLineToSidecar(householdMealId, line, index));
	}
};

export const replaceMealInstructionsFromLines = async (
	db: Db,
	householdMealId: string,
	instructions: string[] = []
) => {
	await db
		.delete(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	for (const [index, instruction] of instructions.entries()) {
		await db
			.insert(householdMealInstructions)
			.values(mealInstructionLineToSidecar(householdMealId, instruction, index));
	}
	const insertedInstructions = await db
		.select({ id: householdMealInstructions.id, text: householdMealInstructions.text })
		.from(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	await insertHouseholdMealInstructionEvents(db, insertedInstructions);
};
