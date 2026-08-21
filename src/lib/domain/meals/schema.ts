import { Schema } from 'effect';

import {
	ConfidenceSchema,
	DomainIdSchema,
	LocalDateSchema,
	LocalTimeSchema,
	MutableAggregateFields,
	PositionSchema,
	UtcInstantSchema,
	isOptionalPair
} from '$lib/domain/contracts/primitives.js';
import {
	ApplianceRequirementSchema,
	InstructionEventKindSchema,
	NutritionFactSchema,
	RecipeClassificationSchema,
	RecipeIngredientSchema,
	RecipeInstructionSchema,
	RecipeMediaSchema
} from '$lib/domain/recipes/schema.js';

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1));
const NullableStringSchema = Schema.NullOr(Schema.String);
const NullableNonNegativeIntSchema = Schema.NullOr(Schema.NonNegativeInt);
const NullableFiniteNumberSchema = Schema.NullOr(
	Schema.Number.pipe(Schema.filter(Number.isFinite))
);
const NullableConfidenceSchema = Schema.NullOr(ConfidenceSchema);

export const MealStatusSchema = Schema.Literal('planned', 'cooked', 'skipped');
export type MealStatus = typeof MealStatusSchema.Type;

export const MealInstructionEventSchema = Schema.Struct({
	id: DomainIdSchema,
	mealInstructionId: DomainIdSchema,
	kind: InstructionEventKindSchema,
	appliance: Schema.NullOr(
		Schema.Literal(
			'oven',
			'stovetop',
			'microwave',
			'air_fryer',
			'slow_cooker',
			'rice_cooker',
			'blender',
			'food_processor',
			'grill'
		)
	),
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
		{ message: () => 'Meal instruction-event payload does not match its kind.' }
	)
);
export type MealInstructionEvent = typeof MealInstructionEventSchema.Type;

const hasUniqueValues = <A>(items: readonly A[], key: (item: A) => string | number): boolean =>
	new Set(items.map(key)).size === items.length;

export const MealAggregateSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	householdId: NonEmptyStringSchema,
	sourceRecipeId: NullableStringSchema,
	title: NonEmptyStringSchema,
	description: NullableStringSchema,
	imageUrl: NullableStringSchema,
	date: Schema.NullOr(LocalDateSchema),
	time: Schema.NullOr(LocalTimeSchema),
	sortOrder: Schema.NullOr(PositionSchema),
	plannedCookUserId: NullableStringSchema,
	yield: NullableFiniteNumberSchema,
	plannedYield: Schema.NullOr(Schema.Int.pipe(Schema.greaterThan(0))),
	status: MealStatusSchema,
	prepTimeMinutes: NullableNonNegativeIntSchema,
	cookTimeMinutes: NullableNonNegativeIntSchema,
	totalTimeMinutes: NullableNonNegativeIntSchema,
	sourceYieldText: NullableStringSchema,
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
	sourceClaimedMinutes: NullableNonNegativeIntSchema,
	parseConfidence: NullableConfidenceSchema,
	ingredientConfidence: NullableConfidenceSchema,
	instructionConfidence: NullableConfidenceSchema,
	nutritionConfidence: NullableConfidenceSchema,
	notes: NullableStringSchema,
	ingredients: Schema.Array(RecipeIngredientSchema),
	instructions: Schema.Array(RecipeInstructionSchema),
	instructionEvents: Schema.Array(MealInstructionEventSchema),
	applianceRequirements: Schema.Array(ApplianceRequirementSchema),
	classifications: Schema.Array(RecipeClassificationSchema),
	media: Schema.Array(RecipeMediaSchema),
	nutritionFacts: Schema.Array(NutritionFactSchema)
}).pipe(
	Schema.filter(
		(meal) => {
			const instructionIds = new Set(meal.instructions.map(({ id }) => id));
			return (
				hasUniqueValues(meal.ingredients, ({ lineIndex }) => lineIndex) &&
				hasUniqueValues(meal.instructions, ({ stepIndex }) => stepIndex) &&
				meal.instructionEvents.every(({ mealInstructionId }) =>
					instructionIds.has(mealInstructionId)
				) &&
				hasUniqueValues(meal.applianceRequirements, ({ appliance }) => appliance) &&
				hasUniqueValues(
					meal.classifications,
					({ kind, normalizedValue, locale }) => `${kind}\u0000${normalizedValue}\u0000${locale}`
				) &&
				hasUniqueValues(meal.media, ({ position }) => position) &&
				hasUniqueValues(meal.nutritionFacts, ({ schemaOrgProperty }) => schemaOrgProperty)
			);
		},
		{ message: () => 'Meal sidecars violate an aggregate uniqueness or ownership invariant.' }
	)
);
export type MealAggregate = typeof MealAggregateSchema.Type;

export const MealPurgeTombstoneSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	householdId: NonEmptyStringSchema,
	purgedAt: UtcInstantSchema,
	retainUntil: UtcInstantSchema
});
export type MealPurgeTombstone = typeof MealPurgeTombstoneSchema.Type;

export const StoredMealSchema = Schema.Union(MealAggregateSchema, MealPurgeTombstoneSchema);
export type StoredMeal = typeof StoredMealSchema.Type;
export const isMealAggregate = (record: StoredMeal): record is MealAggregate =>
	'ingredients' in record;

export const MealVerdictSchema = Schema.Literal('repeat', 'neutral', 'avoid');
export type MealVerdict = typeof MealVerdictSchema.Type;

export const MealCheckInSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	reporterUserId: NonEmptyStringSchema,
	mealId: Schema.NullOr(DomainIdSchema),
	cookTimeMinutes: Schema.NullOr(Schema.Int.pipe(Schema.greaterThan(0))),
	verdict: MealVerdictSchema,
	reason: NullableStringSchema
});
export type MealCheckIn = typeof MealCheckInSchema.Type;

export const MEAL_CONFLICT_GROUPS = [
	'header',
	'schedule',
	'status',
	'ingredients',
	'instructions',
	'appliances',
	'classifications',
	'media',
	'nutrition',
	'deletion'
] as const;

export const mealHasValidOptionalPairs = (meal: MealAggregate): boolean =>
	meal.ingredients.every(({ baseUnitId, baseUnitFamilyId }) =>
		isOptionalPair(baseUnitId, baseUnitFamilyId)
	);
