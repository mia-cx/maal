import { Schema } from 'effect';

import {
	ConfidenceSchema,
	DomainIdSchema,
	LocaleSchema,
	MutableAggregateFields,
	PositionSchema,
	UtcInstantSchema,
	isOptionalPair
} from '$lib/domain/contracts/primitives.js';

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1));
const NullableStringSchema = Schema.NullOr(Schema.String);
const NullableNonNegativeIntSchema = Schema.NullOr(Schema.NonNegativeInt);
const NullableFiniteNumberSchema = Schema.NullOr(
	Schema.Number.pipe(Schema.filter(Number.isFinite))
);
const NullableConfidenceSchema = Schema.NullOr(ConfidenceSchema);

export const ApplianceSchema = Schema.Literal(
	'oven',
	'stovetop',
	'microwave',
	'air_fryer',
	'slow_cooker',
	'rice_cooker',
	'blender',
	'food_processor',
	'grill'
);
export type Appliance = typeof ApplianceSchema.Type;

export const RecipeIngredientSchema = Schema.Struct({
	id: DomainIdSchema,
	lineIndex: PositionSchema,
	originalText: Schema.String,
	sourceAmountText: NullableStringSchema,
	sourceQuantity: NullableFiniteNumberSchema,
	sourceUnitLabel: NullableStringSchema,
	sourceFoodLabel: NonEmptyStringSchema,
	baseFoodId: NullableStringSchema,
	baseQuantity: NullableFiniteNumberSchema,
	baseUnitId: NullableStringSchema,
	baseUnitFamilyId: NullableStringSchema,
	optional: Schema.Boolean,
	confidence: ConfidenceSchema,
	createdAt: UtcInstantSchema
}).pipe(
	Schema.filter((row) => isOptionalPair(row.baseUnitId, row.baseUnitFamilyId), {
		message: () => 'Ingredient unit and family must both be set or both be null.'
	})
);
export type RecipeIngredient = typeof RecipeIngredientSchema.Type;

export const RecipeInstructionSchema = Schema.Struct({
	id: DomainIdSchema,
	stepIndex: PositionSchema,
	sectionName: NullableStringSchema,
	text: Schema.String,
	durationMinutes: NullableNonNegativeIntSchema,
	confidence: NullableConfidenceSchema,
	createdAt: UtcInstantSchema,
	updatedAt: UtcInstantSchema
});
export type RecipeInstruction = typeof RecipeInstructionSchema.Type;

export const InstructionEventKindSchema = Schema.Literal(
	'temperature',
	'duration',
	'appliance',
	'action'
);

export const InstructionEventSchema = Schema.Struct({
	id: DomainIdSchema,
	recipeInstructionId: DomainIdSchema,
	kind: InstructionEventKindSchema,
	appliance: Schema.NullOr(ApplianceSchema),
	sourceText: Schema.String,
	value: NullableFiniteNumberSchema,
	unitId: NullableStringSchema,
	baseValue: NullableFiniteNumberSchema,
	baseUnitId: NullableStringSchema,
	confidence: ConfidenceSchema,
	createdAt: UtcInstantSchema
}).pipe(
	Schema.filter(
		(event) => {
			const emptyMeasure =
				event.value === null &&
				event.unitId === null &&
				event.baseValue === null &&
				event.baseUnitId === null;
			if (event.kind === 'appliance') return event.appliance !== null && emptyMeasure;
			if (event.kind === 'action') return event.appliance === null && emptyMeasure;
			return (
				event.appliance === null &&
				event.value !== null &&
				event.unitId !== null &&
				event.baseValue !== null &&
				event.baseUnitId !== null
			);
		},
		{
			message: () => 'Instruction event payload does not match its kind.'
		}
	)
);
export type InstructionEvent = typeof InstructionEventSchema.Type;

export const ApplianceRequirementSchema = Schema.Struct({
	id: DomainIdSchema,
	appliance: ApplianceSchema,
	required: Schema.Boolean,
	source: Schema.Literal('schema_org', 'instruction_heuristic', 'user'),
	confidence: ConfidenceSchema,
	notes: NullableStringSchema,
	createdAt: UtcInstantSchema,
	updatedAt: UtcInstantSchema
});
export type ApplianceRequirement = typeof ApplianceRequirementSchema.Type;

export const RecipeClassificationSchema = Schema.Struct({
	id: DomainIdSchema,
	kind: Schema.Literal('category', 'cuisine', 'keyword', 'diet'),
	value: NonEmptyStringSchema,
	normalizedValue: NonEmptyStringSchema,
	schemaOrgValue: NullableStringSchema,
	locale: LocaleSchema,
	confidence: ConfidenceSchema,
	createdAt: UtcInstantSchema
});
export type RecipeClassification = typeof RecipeClassificationSchema.Type;

export const RecipeMediaSchema = Schema.Struct({
	id: DomainIdSchema,
	kind: Schema.Literal('image', 'video'),
	position: PositionSchema,
	url: NullableStringSchema,
	contentUrl: NullableStringSchema,
	embedUrl: NullableStringSchema,
	thumbnailUrl: NullableStringSchema,
	name: NullableStringSchema,
	caption: NullableStringSchema,
	createdAt: UtcInstantSchema
}).pipe(
	Schema.filter(
		(row) =>
			[row.url, row.contentUrl, row.embedUrl, row.thumbnailUrl].some((value) => value !== null),
		{ message: () => 'Recipe media requires at least one URL.' }
	)
);
export type RecipeMedia = typeof RecipeMediaSchema.Type;

export const NutritionFactSchema = Schema.Struct({
	id: DomainIdSchema,
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
	schemaOrgProperty: NonEmptyStringSchema,
	originalText: Schema.String,
	amount: NullableFiniteNumberSchema,
	unitId: NullableStringSchema,
	baseAmount: NullableFiniteNumberSchema,
	baseUnitId: NullableStringSchema,
	locale: LocaleSchema,
	confidence: ConfidenceSchema,
	createdAt: UtcInstantSchema,
	updatedAt: UtcInstantSchema
}).pipe(
	Schema.filter((row) => isOptionalPair(row.unitId, row.baseUnitId), {
		message: () => 'Nutrition unit and base unit must both be set or both be null.'
	})
);
export type NutritionFact = typeof NutritionFactSchema.Type;

const RecipeValueFields = {
	savedFromHouseholdId: NullableStringSchema,
	title: NonEmptyStringSchema,
	description: NullableStringSchema,
	imageUrl: NullableStringSchema,
	prepTimeMinutes: NullableNonNegativeIntSchema,
	cookTimeMinutes: NullableNonNegativeIntSchema,
	totalTimeMinutes: NullableNonNegativeIntSchema,
	yield: NullableFiniteNumberSchema,
	sourceYieldText: NullableStringSchema,
	sourceClaimedMinutes: NullableNonNegativeIntSchema,
	sourceDatePublished: NullableStringSchema,
	sourceDateModified: NullableStringSchema,
	sourceLanguage: NullableStringSchema,
	sourceUrl: NullableStringSchema,
	sourceSiteName: NullableStringSchema,
	sourceAuthorName: NullableStringSchema,
	sourcePublisherName: NullableStringSchema,
	sourceIsBasedOnUrl: NullableStringSchema,
	sourceImportedAt: UtcInstantSchema,
	sourceHtmlHash: NullableStringSchema,
	sourceRatingValue: NullableFiniteNumberSchema,
	sourceRatingCount: NullableNonNegativeIntSchema,
	sourceReviewCount: NullableNonNegativeIntSchema,
	parseConfidence: NullableConfidenceSchema,
	ingredientConfidence: NullableConfidenceSchema,
	instructionConfidence: NullableConfidenceSchema,
	nutritionConfidence: NullableConfidenceSchema,
	userNotes: NullableStringSchema
} as const;

const RecipeHeaderFields = {
	id: DomainIdSchema,
	ownerUserId: NonEmptyStringSchema,
	...RecipeValueFields
} as const;

const hasUniqueValues = <A>(items: readonly A[], key: (item: A) => string | number): boolean =>
	new Set(items.map(key)).size === items.length;

const RecipeContentFields = {
	ingredients: Schema.Array(RecipeIngredientSchema),
	instructions: Schema.Array(RecipeInstructionSchema),
	instructionEvents: Schema.Array(InstructionEventSchema),
	applianceRequirements: Schema.Array(ApplianceRequirementSchema),
	classifications: Schema.Array(RecipeClassificationSchema),
	media: Schema.Array(RecipeMediaSchema),
	nutritionFacts: Schema.Array(NutritionFactSchema)
} as const;

export const RecipeAggregateSchema = Schema.Struct({
	...MutableAggregateFields,
	...RecipeHeaderFields,
	...RecipeContentFields,
	searchTokens: Schema.Array(Schema.String)
}).pipe(
	Schema.filter(
		(recipe) => {
			const instructionIds = new Set(recipe.instructions.map(({ id }) => id));
			return (
				hasUniqueValues(recipe.ingredients, ({ lineIndex }) => lineIndex) &&
				hasUniqueValues(recipe.instructions, ({ stepIndex }) => stepIndex) &&
				recipe.instructionEvents.every(({ recipeInstructionId }) =>
					instructionIds.has(recipeInstructionId)
				) &&
				hasUniqueValues(recipe.applianceRequirements, ({ appliance }) => appliance) &&
				hasUniqueValues(
					recipe.classifications,
					({ kind, normalizedValue, locale }) => `${kind}\u0000${normalizedValue}\u0000${locale}`
				) &&
				hasUniqueValues(recipe.media, ({ position }) => position) &&
				hasUniqueValues(recipe.nutritionFacts, ({ schemaOrgProperty }) => schemaOrgProperty)
			);
		},
		{
			message: () => 'Recipe sidecars violate an aggregate uniqueness or ownership invariant.'
		}
	)
);
export type RecipeAggregate = typeof RecipeAggregateSchema.Type;

export const RecipePurgeTombstoneSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	ownerUserId: NonEmptyStringSchema,
	purgedAt: UtcInstantSchema,
	retainUntil: UtcInstantSchema,
	purgeReason: Schema.Literal('permanent_delete', 'recovery_expired'),
	searchTokens: Schema.Array(Schema.String)
});
export type RecipePurgeTombstone = typeof RecipePurgeTombstoneSchema.Type;

export const StoredRecipeSchema = Schema.Union(RecipeAggregateSchema, RecipePurgeTombstoneSchema);
export type StoredRecipe = typeof StoredRecipeSchema.Type;

export const RecipeImportedCandidateSchema = Schema.Struct({
	...RecipeValueFields,
	...RecipeContentFields
});
export type RecipeImportedCandidate = typeof RecipeImportedCandidateSchema.Type;

export const isRecipeAggregate = (record: StoredRecipe): record is RecipeAggregate =>
	'ingredients' in record;

export const RECIPE_CONFLICT_GROUPS = [
	'header',
	'ingredients',
	'instructions',
	'appliances',
	'classifications',
	'media',
	'nutrition',
	'deletion'
] as const;
export type RecipeConflictGroup = (typeof RECIPE_CONFLICT_GROUPS)[number];
