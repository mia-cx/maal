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
export const BaseUnit = Schema.Literal('g', 'ml', 'count');

export const IngredientId = Schema.String.pipe(Schema.startsWith('ing_'));
export const UnitId = Schema.String.pipe(Schema.startsWith('unit_'));

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
	baseUnit: BaseUnit,
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

export const ParsedRecipeIngredientSidecar = Schema.Struct({
	// schema.org source fidelity
	originalText: Schema.String,
	sourceAmountText: Schema.optional(Schema.String),
	sourceIngredientLabel: Schema.String,

	// Maal interpretation for merging and display
	baseQuantity: Schema.optional(Schema.Number),
	baseUnit: Schema.optional(BaseUnit),
	ingredientId: Schema.optional(IngredientId),
	groceryRollupIngredientId: Schema.optional(IngredientId),
	displayLabelOverride: Schema.optional(Schema.String),
	displayUnitOverride: Schema.optional(UnitId),
	parseConfidence: ConfidenceScore
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
export type ParsedRecipeIngredientSidecar = Schema.Schema.Type<
	typeof ParsedRecipeIngredientSidecar
>;
export type TaxonomyProposal = Schema.Schema.Type<typeof TaxonomyProposal>;
