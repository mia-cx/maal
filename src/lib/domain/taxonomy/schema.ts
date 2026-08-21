import { Schema } from 'effect';

import {
	DomainIdSchema,
	LocaleSchema,
	MutableAggregateFields,
	UtcInstantSchema,
	isOptionalPair
} from '$lib/domain/contracts/primitives.js';

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1));
const FiniteNumberSchema = Schema.Number.pipe(Schema.filter(Number.isFinite));

const TimestampFields = {
	createdAt: UtcInstantSchema,
	updatedAt: UtcInstantSchema
} as const;

export const AdoptionStatusSchema = Schema.Literal('pending_review', 'accepted', 'rejected');
export type AdoptionStatus = typeof AdoptionStatusSchema.Type;

export const FoodPreferenceValueSchema = Schema.Literal(
	'favourite',
	'like',
	'dislike',
	'disallowed'
);
export type FoodPreferenceValue = typeof FoodPreferenceValueSchema.Type;

export const UserAliasScopeSchema = Schema.Literal('global', 'household', 'user');
export const HouseholdAliasScopeSchema = Schema.Literal('global', 'household');
export type UserAliasScope = typeof UserAliasScopeSchema.Type;
export type HouseholdAliasScope = typeof HouseholdAliasScopeSchema.Type;

const optionalMeasurePair = <A extends object>(schema: Schema.Schema<A>) =>
	schema.pipe(
		Schema.filter(
			(row) =>
				isOptionalPair(
					(row as A & { defaultMeasureUnitId: unknown }).defaultMeasureUnitId,
					(row as A & { defaultMeasureBaseUnitId: unknown }).defaultMeasureBaseUnitId
				),
			{ message: () => 'Default measure unit and base unit must both be set or both be null.' }
		)
	);

const optionalPreferredMeasurePair = <A extends object>(schema: Schema.Schema<A>) =>
	schema.pipe(
		Schema.filter(
			(row) =>
				isOptionalPair(
					(row as A & { preferredMeasureUnitId: unknown }).preferredMeasureUnitId,
					(row as A & { preferredMeasureBaseUnitId: unknown }).preferredMeasureBaseUnitId
				),
			{ message: () => 'Preferred measure unit and base unit must both be set or both be null.' }
		)
	);

const optionalAliasPair = <A extends object>(
	schema: Schema.Schema<A>,
	scopeKey: 'preferredFoodAliasScope' | 'preferredUnitAliasScope',
	idKey: 'preferredFoodAliasId' | 'preferredUnitAliasId'
) =>
	schema.pipe(
		Schema.filter(
			(row) =>
				isOptionalPair(
					(row as A & Record<typeof scopeKey, unknown>)[scopeKey],
					(row as A & Record<typeof idKey, unknown>)[idKey]
				),
			{ message: () => 'Preferred alias scope and ID must both be set or both be null.' }
		)
	);

export const UnitSchema = Schema.Struct({
	id: NonEmptyStringSchema,
	baseUnitId: NonEmptyStringSchema,
	toBaseFactor: FiniteNumberSchema,
	toBaseOffset: FiniteNumberSchema
});
export type Unit = typeof UnitSchema.Type;

export const FoodSchema = Schema.Struct({
	id: NonEmptyStringSchema,
	defaultMeasureUnitId: NonEmptyStringSchema,
	defaultMeasureBaseUnitId: NonEmptyStringSchema
});
export type Food = typeof FoodSchema.Type;

export const UnitAliasSchema = Schema.Struct({
	id: NonEmptyStringSchema,
	unitId: NonEmptyStringSchema,
	baseUnitId: NonEmptyStringSchema,
	alias: NonEmptyStringSchema,
	pluralAlias: Schema.NullOr(NonEmptyStringSchema),
	locale: LocaleSchema,
	sourceDomain: Schema.NullOr(NonEmptyStringSchema),
	defaultForLocale: Schema.Boolean,
	...TimestampFields
}).pipe(
	Schema.filter((row) => row.sourceDomain === null || !row.defaultForLocale, {
		message: () => 'A domain-specific unit alias cannot be the locale default.'
	})
);
export type UnitAlias = typeof UnitAliasSchema.Type;

export const FoodAliasSchema = optionalMeasurePair(
	Schema.Struct({
		id: NonEmptyStringSchema,
		foodId: NonEmptyStringSchema,
		alias: NonEmptyStringSchema,
		locale: LocaleSchema,
		sourceDomain: Schema.NullOr(NonEmptyStringSchema),
		defaultForLocale: Schema.Boolean,
		defaultMeasureUnitId: Schema.NullOr(NonEmptyStringSchema),
		defaultMeasureBaseUnitId: Schema.NullOr(NonEmptyStringSchema),
		...TimestampFields
	}).pipe(
		Schema.filter((row) => row.sourceDomain === null || !row.defaultForLocale, {
			message: () => 'A domain-specific food alias cannot be the locale default.'
		})
	)
);
export type FoodAlias = typeof FoodAliasSchema.Type;

const ScopedFoodAliasFields = {
	...MutableAggregateFields,
	id: DomainIdSchema,
	foodId: NonEmptyStringSchema,
	alias: NonEmptyStringSchema,
	locale: LocaleSchema,
	sourceDomain: Schema.NullOr(NonEmptyStringSchema),
	adoptionStatus: AdoptionStatusSchema,
	defaultMeasureUnitId: Schema.NullOr(NonEmptyStringSchema),
	defaultMeasureBaseUnitId: Schema.NullOr(NonEmptyStringSchema)
} as const;

export const FoodUserAliasSchema = optionalMeasurePair(
	Schema.Struct({ workosUserId: NonEmptyStringSchema, ...ScopedFoodAliasFields })
);
export type FoodUserAlias = typeof FoodUserAliasSchema.Type;

export const FoodHouseholdAliasSchema = optionalMeasurePair(
	Schema.Struct({ householdId: NonEmptyStringSchema, ...ScopedFoodAliasFields })
);
export type FoodHouseholdAlias = typeof FoodHouseholdAliasSchema.Type;

const ScopedFoodEntryFields = {
	...MutableAggregateFields,
	id: DomainIdSchema,
	canonicalLabel: NonEmptyStringSchema,
	defaultMeasureUnitId: Schema.NullOr(NonEmptyStringSchema),
	defaultMeasureBaseUnitId: Schema.NullOr(NonEmptyStringSchema),
	adoptionStatus: AdoptionStatusSchema
} as const;

export const FoodUserEntrySchema = optionalMeasurePair(
	Schema.Struct({ workosUserId: NonEmptyStringSchema, ...ScopedFoodEntryFields })
);
export type FoodUserEntry = typeof FoodUserEntrySchema.Type;

export const FoodHouseholdEntrySchema = optionalMeasurePair(
	Schema.Struct({ householdId: NonEmptyStringSchema, ...ScopedFoodEntryFields })
);
export type FoodHouseholdEntry = typeof FoodHouseholdEntrySchema.Type;

const ScopedUnitAliasFields = {
	...MutableAggregateFields,
	id: DomainIdSchema,
	unitId: NonEmptyStringSchema,
	baseUnitId: NonEmptyStringSchema,
	alias: NonEmptyStringSchema,
	pluralAlias: Schema.NullOr(NonEmptyStringSchema),
	locale: LocaleSchema,
	sourceDomain: Schema.NullOr(NonEmptyStringSchema),
	adoptionStatus: AdoptionStatusSchema
} as const;

export const UnitUserAliasSchema = Schema.Struct({
	workosUserId: NonEmptyStringSchema,
	...ScopedUnitAliasFields
});
export type UnitUserAlias = typeof UnitUserAliasSchema.Type;

export const UnitHouseholdAliasSchema = Schema.Struct({
	householdId: NonEmptyStringSchema,
	...ScopedUnitAliasFields
});
export type UnitHouseholdAlias = typeof UnitHouseholdAliasSchema.Type;

const ScopedUnitEntryFields = {
	...MutableAggregateFields,
	id: DomainIdSchema,
	canonicalLabel: NonEmptyStringSchema,
	baseUnitId: NonEmptyStringSchema,
	toBaseFactor: FiniteNumberSchema,
	toBaseOffset: FiniteNumberSchema,
	adoptionStatus: AdoptionStatusSchema
} as const;

export const UnitUserEntrySchema = Schema.Struct({
	workosUserId: NonEmptyStringSchema,
	...ScopedUnitEntryFields
});
export type UnitUserEntry = typeof UnitUserEntrySchema.Type;

export const UnitHouseholdEntrySchema = Schema.Struct({
	householdId: NonEmptyStringSchema,
	...ScopedUnitEntryFields
});
export type UnitHouseholdEntry = typeof UnitHouseholdEntrySchema.Type;

export const UserFoodPreferenceSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	workosUserId: NonEmptyStringSchema,
	foodId: NonEmptyStringSchema,
	preference: FoodPreferenceValueSchema,
	reason: Schema.NullOr(NonEmptyStringSchema)
});
export type UserFoodPreference = typeof UserFoodPreferenceSchema.Type;

const FoodDisplayPreferenceFields = {
	...MutableAggregateFields,
	id: DomainIdSchema,
	foodId: NonEmptyStringSchema,
	locale: LocaleSchema,
	preferredFoodAliasId: Schema.NullOr(NonEmptyStringSchema),
	preferredMeasureUnitId: Schema.NullOr(NonEmptyStringSchema),
	preferredMeasureBaseUnitId: Schema.NullOr(NonEmptyStringSchema)
} as const;

export const UserFoodDisplayPreferenceSchema = optionalPreferredMeasurePair(
	optionalAliasPair(
		Schema.Struct({
			workosUserId: NonEmptyStringSchema,
			preferredFoodAliasScope: Schema.NullOr(UserAliasScopeSchema),
			...FoodDisplayPreferenceFields
		}),
		'preferredFoodAliasScope',
		'preferredFoodAliasId'
	)
);
export type UserFoodDisplayPreference = typeof UserFoodDisplayPreferenceSchema.Type;

export const HouseholdFoodDisplayPreferenceSchema = optionalPreferredMeasurePair(
	optionalAliasPair(
		Schema.Struct({
			householdId: NonEmptyStringSchema,
			preferredFoodAliasScope: Schema.NullOr(HouseholdAliasScopeSchema),
			...FoodDisplayPreferenceFields
		}),
		'preferredFoodAliasScope',
		'preferredFoodAliasId'
	)
);
export type HouseholdFoodDisplayPreference = typeof HouseholdFoodDisplayPreferenceSchema.Type;

const UnitDisplayPreferenceFields = {
	...MutableAggregateFields,
	id: DomainIdSchema,
	baseUnitId: NonEmptyStringSchema,
	locale: LocaleSchema,
	preferredUnitId: NonEmptyStringSchema,
	preferredUnitAliasId: Schema.NullOr(NonEmptyStringSchema)
} as const;

export const UserUnitDisplayPreferenceSchema = optionalAliasPair(
	Schema.Struct({
		workosUserId: NonEmptyStringSchema,
		preferredUnitAliasScope: Schema.NullOr(UserAliasScopeSchema),
		...UnitDisplayPreferenceFields
	}),
	'preferredUnitAliasScope',
	'preferredUnitAliasId'
);
export type UserUnitDisplayPreference = typeof UserUnitDisplayPreferenceSchema.Type;

export const HouseholdUnitDisplayPreferenceSchema = optionalAliasPair(
	Schema.Struct({
		householdId: NonEmptyStringSchema,
		preferredUnitAliasScope: Schema.NullOr(HouseholdAliasScopeSchema),
		...UnitDisplayPreferenceFields
	}),
	'preferredUnitAliasScope',
	'preferredUnitAliasId'
);
export type HouseholdUnitDisplayPreference = typeof HouseholdUnitDisplayPreferenceSchema.Type;

export const TaxonomyEditableEntityKindSchema = Schema.Literal(
	'foodUserAlias',
	'foodHouseholdAlias',
	'foodUserEntry',
	'foodHouseholdEntry',
	'unitUserAlias',
	'unitHouseholdAlias',
	'unitUserEntry',
	'unitHouseholdEntry',
	'userFoodPreference',
	'userFoodDisplayPreference',
	'householdFoodDisplayPreference',
	'userUnitDisplayPreference',
	'householdUnitDisplayPreference'
);
export type TaxonomyEditableEntityKind = typeof TaxonomyEditableEntityKindSchema.Type;

export const TaxonomyEditableSchemas = {
	foodUserAlias: FoodUserAliasSchema,
	foodHouseholdAlias: FoodHouseholdAliasSchema,
	foodUserEntry: FoodUserEntrySchema,
	foodHouseholdEntry: FoodHouseholdEntrySchema,
	unitUserAlias: UnitUserAliasSchema,
	unitHouseholdAlias: UnitHouseholdAliasSchema,
	unitUserEntry: UnitUserEntrySchema,
	unitHouseholdEntry: UnitHouseholdEntrySchema,
	userFoodPreference: UserFoodPreferenceSchema,
	userFoodDisplayPreference: UserFoodDisplayPreferenceSchema,
	householdFoodDisplayPreference: HouseholdFoodDisplayPreferenceSchema,
	userUnitDisplayPreference: UserUnitDisplayPreferenceSchema,
	householdUnitDisplayPreference: HouseholdUnitDisplayPreferenceSchema
} as const;

export const TaxonomySnapshotSchema = Schema.Struct({
	foods: Schema.Array(FoodSchema),
	foodAliases: Schema.Array(FoodAliasSchema),
	foodUserAliases: Schema.Array(FoodUserAliasSchema),
	foodHouseholdAliases: Schema.Array(FoodHouseholdAliasSchema),
	foodUserEntries: Schema.Array(FoodUserEntrySchema),
	foodHouseholdEntries: Schema.Array(FoodHouseholdEntrySchema),
	units: Schema.Array(UnitSchema),
	unitAliases: Schema.Array(UnitAliasSchema),
	unitUserAliases: Schema.Array(UnitUserAliasSchema),
	unitHouseholdAliases: Schema.Array(UnitHouseholdAliasSchema),
	unitUserEntries: Schema.Array(UnitUserEntrySchema),
	unitHouseholdEntries: Schema.Array(UnitHouseholdEntrySchema),
	userFoodPreferences: Schema.Array(UserFoodPreferenceSchema),
	userFoodDisplayPreferences: Schema.Array(UserFoodDisplayPreferenceSchema),
	householdFoodDisplayPreferences: Schema.Array(HouseholdFoodDisplayPreferenceSchema),
	userUnitDisplayPreferences: Schema.Array(UserUnitDisplayPreferenceSchema),
	householdUnitDisplayPreferences: Schema.Array(HouseholdUnitDisplayPreferenceSchema)
});
export type TaxonomySnapshot = typeof TaxonomySnapshotSchema.Type;
