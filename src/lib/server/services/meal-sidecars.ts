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

type Db = ReturnType<typeof getDb>;

type RecipeIngredient = typeof userRecipeIngredients.$inferSelect;
type RecipeInstruction = typeof userRecipeInstructions.$inferSelect;

const mealIngredientValues = (householdMealId: string, ingredient: RecipeIngredient) => ({
	householdMealId,
	lineIndex: ingredient.lineIndex,
	originalText: ingredient.originalText,
	sourceAmountText: ingredient.sourceAmountText,
	sourceQuantity: ingredient.sourceQuantity,
	sourceUnitLabel: ingredient.sourceUnitLabel,
	sourceFoodLabel: ingredient.sourceFoodLabel,
	baseFoodId: ingredient.baseFoodId,
	baseQuantity: ingredient.baseQuantity,
	baseUnitId: ingredient.baseUnitId,
	baseUnitFamilyId: ingredient.baseUnitFamilyId,
	optional: ingredient.optional,
	confidence: ingredient.confidence
});

const mealInstructionValues = (householdMealId: string, instruction: RecipeInstruction) => ({
	householdMealId,
	stepIndex: instruction.stepIndex,
	sectionName: instruction.sectionName,
	text: instruction.text,
	durationMinutes: instruction.durationMinutes,
	confidence: instruction.confidence
});

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
			.values(mealIngredientValues(householdMealId, ingredient));
	}

	await db
		.delete(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	for (const instruction of instructions) {
		await db
			.insert(householdMealInstructions)
			.values(mealInstructionValues(householdMealId, instruction));
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
			.values(mealIngredientValues(householdMealId, ingredient));
	}
	for (const instruction of instructions) {
		await db
			.insert(householdMealInstructions)
			.values(mealInstructionValues(householdMealId, instruction));
	}
	await insertInstructionEventsForMeal(db, householdMealId);

	for (const classification of classifications) {
		await db.insert(householdMealClassifications).values({
			householdMealId,
			kind: classification.kind,
			value: classification.value,
			normalizedValue: classification.normalizedValue,
			schemaOrgValue: classification.schemaOrgValue,
			locale: classification.locale,
			confidence: classification.confidence
		});
	}
	for (const item of media) {
		await db.insert(householdMealMedia).values({
			householdMealId,
			kind: item.kind,
			position: item.position,
			url: item.url,
			contentUrl: item.contentUrl,
			embedUrl: item.embedUrl,
			thumbnailUrl: item.thumbnailUrl,
			name: item.name,
			caption: item.caption
		});
	}
	for (const fact of nutritionFacts) {
		await db.insert(householdMealNutritionFacts).values({
			householdMealId,
			nutrient: fact.nutrient,
			schemaOrgProperty: fact.schemaOrgProperty,
			originalText: fact.originalText,
			amount: fact.amount,
			unitId: fact.unitId,
			baseAmount: fact.baseAmount,
			baseUnitId: fact.baseUnitId,
			locale: fact.locale,
			confidence: fact.confidence
		});
	}
};
