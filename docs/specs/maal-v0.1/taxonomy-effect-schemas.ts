// Draft Effect Schema shape for review only. This assumes `effect/Schema` if/when
// we adopt Effect for runtime DTO validation. It is intentionally not wired into
// app code yet.

import * as Schema from 'effect/Schema';

export const Locale = Schema.String.pipe(Schema.pattern(/^[a-z]{2,3}(?:-[A-Z]{2})?$/));
export const ConfidenceScore = Schema.Number.pipe(Schema.between(0, 1));

export const TaxonomyStatus = Schema.Literal('active', 'provisional', 'deprecated');
export const ReviewStatus = Schema.Literal('active', 'pending', 'rejected');
export const ProposalStatus = Schema.Literal('pending', 'approved', 'rejected', 'merged');
export const MeasureKind = Schema.Literal('mass', 'volume', 'count');
export const CanonicalUnitKey = Schema.String;
export const MealStatus = Schema.Literal(
	'planned',
	'cooked',
	'skipped',
	'postponed',
	'replaced',
	'archived'
);

export const IngredientId = Schema.String.pipe(Schema.startsWith('ing_'));
export const UnitId = Schema.String.pipe(Schema.startsWith('unit_'));
export const RecipeId = Schema.String;
export const HouseholdMealId = Schema.String;
export const WorkOsUserId = Schema.String;
export const MealFeedbackVerdict = Schema.Literal('worth_repeating', 'neutral', 'never_again');

export const Ingredient = Schema.Struct({
	id: IngredientId,
	canonicalKey: Schema.String,
	defaultLabel: Schema.String,
	kind: Schema.Literal('ingredient', 'variant'),
	parentIngredientId: Schema.optional(IngredientId),
	groceryRollupIngredientId: Schema.optional(IngredientId),
	defaultMeasureKind: Schema.optional(MeasureKind),
	category: Schema.optional(Schema.String),
	status: TaxonomyStatus
});

export const IngredientLabel = Schema.Struct({
	ingredientId: IngredientId,
	locale: Locale,
	label: Schema.String,
	normalizedLabel: Schema.String,
	source: Schema.Literal('system', 'community', 'user_seed'),
	status: ReviewStatus
});

export const IngredientAlias = Schema.Struct({
	ingredientId: IngredientId,
	alias: Schema.String,
	normalizedAlias: Schema.String,
	locale: Schema.optional(Locale),
	sourceDomain: Schema.optional(Schema.String),
	confidence: ConfidenceScore,
	status: ReviewStatus
});

export const Unit = Schema.Struct({
	id: UnitId,
	canonicalKey: Schema.String,
	symbol: Schema.String,
	kind: MeasureKind,
	baseUnit: CanonicalUnitKey,
	toBaseFactor: Schema.Number.pipe(Schema.positive()),
	status: Schema.Literal('active', 'deprecated')
});

export const UnitLabel = Schema.Struct({
	unitId: UnitId,
	locale: Locale,
	label: Schema.String,
	normalizedLabel: Schema.String,
	status: ReviewStatus
});

export const UnitAlias = Schema.Struct({
	unitId: UnitId,
	alias: Schema.String,
	normalizedAlias: Schema.String,
	locale: Schema.optional(Locale),
	status: ReviewStatus
});

export const IngredientDisplayOverride = Schema.Struct({
	scope: Schema.Literal('user', 'household'),
	scopeId: Schema.String,
	ingredientId: IngredientId,
	displayLabel: Schema.optional(Schema.String),
	preferredUnitId: Schema.optional(UnitId)
});

export const FlattenedRecipeIngredient = Schema.Struct({
	// Source fidelity from schema.org recipeIngredient lines or user input.
	originalText: Schema.String,
	sourceAmountText: Schema.optional(Schema.String),
	sourceIngredientLabel: Schema.String,

	// Maal interpretation for filtering, grocery merging, display, and one-off edits.
	baseQuantity: Schema.optional(Schema.Number),
	baseUnit: Schema.optional(CanonicalUnitKey),
	ingredientId: Schema.optional(IngredientId),
	groceryRollupIngredientId: Schema.optional(IngredientId),
	displayLabelOverride: Schema.optional(Schema.String),
	displayUnitOverride: Schema.optional(UnitId),
	category: Schema.optional(Schema.String),
	optional: Schema.Boolean,
	parseConfidence: ConfidenceScore
});

export const RecipeInstruction = Schema.Struct({
	stepIndex: Schema.Number,
	sectionName: Schema.optional(Schema.String),
	text: Schema.String,
	durationMinutes: Schema.optional(Schema.Number),
	confidence: Schema.optional(ConfidenceScore)
});

export const RecipeClassification = Schema.Struct({
	kind: Schema.Literal('category', 'cuisine', 'keyword', 'diet'),
	value: Schema.String,
	normalizedValue: Schema.String,
	schemaOrgValue: Schema.optional(Schema.String),
	locale: Schema.optional(Locale),
	confidence: ConfidenceScore
});

export const RecipeMedia = Schema.Struct({
	kind: Schema.Literal('image', 'video'),
	position: Schema.Number,
	url: Schema.optional(Schema.String),
	contentUrl: Schema.optional(Schema.String),
	embedUrl: Schema.optional(Schema.String),
	thumbnailUrl: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	caption: Schema.optional(Schema.String)
});

export const NutritionFact = Schema.Struct({
	nutrient: Schema.Literal(
		'calories',
		'carbohydrate',
		'cholesterol',
		'fat',
		'fiber',
		'protein',
		'saturated_fat',
		'serving_size',
		'sodium',
		'sugar',
		'trans_fat',
		'unsaturated_fat',
		'other'
	),
	schemaOrgProperty: Schema.String,
	originalText: Schema.String,
	amount: Schema.optional(Schema.Number),
	unit: Schema.optional(Schema.String),
	baseAmount: Schema.optional(Schema.Number),
	baseUnit: Schema.optional(Schema.String),
	locale: Schema.optional(Locale),
	confidence: ConfidenceScore
});

export const UserRecipe = Schema.Struct({
	id: RecipeId,
	workosUserId: Schema.String,
	savedFromHouseholdId: Schema.optional(Schema.String),
	title: Schema.String,
	description: Schema.optional(Schema.String),
	imageUrl: Schema.optional(Schema.String),
	prepTimeMinutes: Schema.optional(Schema.Number),
	cookTimeMinutes: Schema.optional(Schema.Number),
	totalTimeMinutes: Schema.optional(Schema.Number),
	servings: Schema.optional(Schema.Number),
	sourceYieldText: Schema.optional(Schema.String),
	sourceDatePublished: Schema.optional(Schema.String),
	sourceDateModified: Schema.optional(Schema.String),
	sourceLanguage: Schema.optional(Schema.String),
	sourceRatingValue: Schema.optional(Schema.Number),
	sourceRatingCount: Schema.optional(Schema.Number),
	sourceReviewCount: Schema.optional(Schema.Number),
	ingredients: Schema.Array(FlattenedRecipeIngredient),
	instructions: Schema.Array(RecipeInstruction),
	classifications: Schema.Array(RecipeClassification),
	media: Schema.Array(RecipeMedia),
	nutritionFacts: Schema.Array(NutritionFact)
});

export const HouseholdMeal = Schema.Struct({
	id: HouseholdMealId,
	householdId: Schema.String,
	userRecipeId: Schema.optional(RecipeId),
	title: Schema.String,
	description: Schema.optional(Schema.String),
	imageUrl: Schema.optional(Schema.String),
	prepTimeMinutes: Schema.optional(Schema.Number),
	cookTimeMinutes: Schema.optional(Schema.Number),
	baseServings: Schema.Number.pipe(Schema.positive()),
	servingsPlanned: Schema.Number.pipe(Schema.positive()),
	status: MealStatus,
	sourceYieldText: Schema.optional(Schema.String),
	sourceDatePublished: Schema.optional(Schema.String),
	sourceDateModified: Schema.optional(Schema.String),
	sourceLanguage: Schema.optional(Schema.String),
	sourceRatingValue: Schema.optional(Schema.Number),
	sourceRatingCount: Schema.optional(Schema.Number),
	sourceReviewCount: Schema.optional(Schema.Number),
	ingredients: Schema.Array(FlattenedRecipeIngredient),
	instructions: Schema.Array(RecipeInstruction),
	classifications: Schema.Array(RecipeClassification),
	media: Schema.Array(RecipeMedia),
	nutritionFacts: Schema.Array(NutritionFact)
});

export const MealReview = Schema.Struct({
	id: Schema.String,
	householdId: Schema.String,
	householdMealId: HouseholdMealId,
	userRecipeId: Schema.optional(RecipeId),
	workosUserId: WorkOsUserId,
	rating: Schema.optional(Schema.Number.pipe(Schema.between(1, 5))),
	verdict: Schema.optional(MealFeedbackVerdict),
	title: Schema.optional(Schema.String),
	body: Schema.optional(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String
});

export const TaxonomyProposal = Schema.Struct({
	id: Schema.String,
	type: Schema.Literal(
		'ingredient_alias',
		'ingredient_label',
		'ingredient_variant',
		'new_ingredient',
		'unit_alias',
		'unit_label',
		'new_unit'
	),
	status: ProposalStatus,
	createdByWorkosUserId: Schema.String,
	locale: Schema.optional(Locale),
	sourceDomain: Schema.optional(Schema.String),
	payload: Schema.Record({ key: Schema.String, value: Schema.Unknown })
});

export type Ingredient = Schema.Schema.Type<typeof Ingredient>;
export type IngredientAlias = Schema.Schema.Type<typeof IngredientAlias>;
export type Unit = Schema.Schema.Type<typeof Unit>;
export type FlattenedRecipeIngredient = Schema.Schema.Type<typeof FlattenedRecipeIngredient>;
export type RecipeClassification = Schema.Schema.Type<typeof RecipeClassification>;
export type RecipeMedia = Schema.Schema.Type<typeof RecipeMedia>;
export type NutritionFact = Schema.Schema.Type<typeof NutritionFact>;
export type UserRecipe = Schema.Schema.Type<typeof UserRecipe>;
export type HouseholdMeal = Schema.Schema.Type<typeof HouseholdMeal>;
export type MealReview = Schema.Schema.Type<typeof MealReview>;
export type TaxonomyProposal = Schema.Schema.Type<typeof TaxonomyProposal>;
