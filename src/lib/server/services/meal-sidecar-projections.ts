import type {
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

type RecipeIngredient = typeof userRecipeIngredients.$inferSelect;
type RecipeInstruction = typeof userRecipeInstructions.$inferSelect;
type RecipeClassification = typeof userRecipeClassifications.$inferSelect;
type RecipeMedia = typeof userRecipeMedia.$inferSelect;
type RecipeNutritionFact = typeof userRecipeNutritionFacts.$inferSelect;

export const recipeIngredientToMealIngredient = (
	householdMealId: string,
	ingredient: RecipeIngredient
): typeof householdMealIngredients.$inferInsert => ({
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

export const recipeInstructionToMealInstruction = (
	householdMealId: string,
	instruction: RecipeInstruction
): typeof householdMealInstructions.$inferInsert => ({
	householdMealId,
	stepIndex: instruction.stepIndex,
	sectionName: instruction.sectionName,
	text: instruction.text,
	durationMinutes: instruction.durationMinutes,
	confidence: instruction.confidence
});

export const recipeClassificationToMealClassification = (
	householdMealId: string,
	classification: RecipeClassification
): typeof householdMealClassifications.$inferInsert => ({
	householdMealId,
	kind: classification.kind,
	value: classification.value,
	normalizedValue: classification.normalizedValue,
	schemaOrgValue: classification.schemaOrgValue,
	locale: classification.locale,
	confidence: classification.confidence
});

export const recipeMediaToMealMedia = (
	householdMealId: string,
	item: RecipeMedia
): typeof householdMealMedia.$inferInsert => ({
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

export const recipeNutritionFactToMealNutritionFact = (
	householdMealId: string,
	fact: RecipeNutritionFact
): typeof householdMealNutritionFacts.$inferInsert => ({
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
