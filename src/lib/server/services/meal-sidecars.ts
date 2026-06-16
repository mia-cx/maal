import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	householdMealClassifications,
	householdMealIngredients,
	householdMealInstructions,
	householdMealMedia,
	householdMealNutritionFacts,
	userRecipeClassifications,
	userRecipeIngredients,
	userRecipeInstructions,
	userRecipeMedia,
	userRecipeNutritionFacts
} from '$lib/server/db/schema';
import { insertHouseholdMealInstructionEvents } from '$lib/server/taxonomy/instruction-events';
import {
	recipeClassificationToMealClassification,
	recipeIngredientToMealIngredient,
	recipeInstructionToMealInstruction,
	recipeMediaToMealMedia,
	recipeNutritionFactToMealNutritionFact
} from './meal-sidecar-projections';

type Db = ReturnType<typeof getDb>;

const insertInstructionEventsForMeal = async (db: Db, householdMealId: string) => {
	const insertedInstructions = await db
		.select({ id: householdMealInstructions.id, text: householdMealInstructions.text })
		.from(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	await insertHouseholdMealInstructionEvents(db, insertedInstructions);
};

const loadRecipeCoreSidecars = async (db: Db, userRecipeId: string) =>
	Promise.all([
		db
			.select()
			.from(userRecipeIngredients)
			.where(eq(userRecipeIngredients.userRecipeId, userRecipeId)),
		db
			.select()
			.from(userRecipeInstructions)
			.where(eq(userRecipeInstructions.userRecipeId, userRecipeId))
	]);

export const replaceMealRecipeSidecars = async (
	db: Db,
	householdMealId: string,
	userRecipeId: string
) => {
	const [ingredients, instructions] = await loadRecipeCoreSidecars(db, userRecipeId);

	await db
		.delete(householdMealIngredients)
		.where(eq(householdMealIngredients.householdMealId, householdMealId));
	for (const ingredient of ingredients) {
		await db
			.insert(householdMealIngredients)
			.values(recipeIngredientToMealIngredient(householdMealId, ingredient));
	}

	await db
		.delete(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	for (const instruction of instructions) {
		await db
			.insert(householdMealInstructions)
			.values(recipeInstructionToMealInstruction(householdMealId, instruction));
	}
	await insertInstructionEventsForMeal(db, householdMealId);
};

export const copyRecipeSidecarsToMeal = async (
	db: Db,
	userRecipeId: string,
	householdMealId: string
) => {
	const [ingredients, instructions, classifications, media, nutritionFacts] = await Promise.all([
		db
			.select()
			.from(userRecipeIngredients)
			.where(eq(userRecipeIngredients.userRecipeId, userRecipeId)),
		db
			.select()
			.from(userRecipeInstructions)
			.where(eq(userRecipeInstructions.userRecipeId, userRecipeId)),
		db
			.select()
			.from(userRecipeClassifications)
			.where(eq(userRecipeClassifications.userRecipeId, userRecipeId)),
		db.select().from(userRecipeMedia).where(eq(userRecipeMedia.userRecipeId, userRecipeId)),
		db
			.select()
			.from(userRecipeNutritionFacts)
			.where(eq(userRecipeNutritionFacts.userRecipeId, userRecipeId))
	]);

	for (const ingredient of ingredients) {
		await db
			.insert(householdMealIngredients)
			.values(recipeIngredientToMealIngredient(householdMealId, ingredient));
	}
	for (const instruction of instructions) {
		await db
			.insert(householdMealInstructions)
			.values(recipeInstructionToMealInstruction(householdMealId, instruction));
	}
	await insertInstructionEventsForMeal(db, householdMealId);

	for (const classification of classifications) {
		await db
			.insert(householdMealClassifications)
			.values(recipeClassificationToMealClassification(householdMealId, classification));
	}
	for (const item of media) {
		await db.insert(householdMealMedia).values(recipeMediaToMealMedia(householdMealId, item));
	}
	for (const fact of nutritionFacts) {
		await db
			.insert(householdMealNutritionFacts)
			.values(recipeNutritionFactToMealNutritionFact(householdMealId, fact));
	}
};
