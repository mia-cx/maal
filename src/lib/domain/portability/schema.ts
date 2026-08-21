import { Schema } from 'effect';

import { UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import { HouseholdApplianceSchema, HouseholdSchema } from '$lib/domain/household/contracts.js';
import { MealAggregateSchema, MealCheckInSchema } from '$lib/domain/meals/schema.js';
import { RecipeAggregateSchema } from '$lib/domain/recipes/schema.js';
import {
	FoodAliasSchema,
	FoodHouseholdAliasSchema,
	FoodHouseholdEntrySchema,
	FoodSchema,
	FoodUserAliasSchema,
	FoodUserEntrySchema,
	HouseholdFoodDisplayPreferenceSchema,
	HouseholdUnitDisplayPreferenceSchema,
	UnitAliasSchema,
	UnitHouseholdAliasSchema,
	UnitHouseholdEntrySchema,
	UnitSchema,
	UnitUserAliasSchema,
	UnitUserEntrySchema,
	UserFoodDisplayPreferenceSchema,
	UserFoodPreferenceSchema,
	UserUnitDisplayPreferenceSchema
} from '$lib/domain/taxonomy/schema.js';

export const PORTABLE_ARCHIVE_FORMAT_VERSION = 2 as const;
export const PORTABLE_FILE_VERSION = 1 as const;

const FileVersionFields = { version: Schema.Literal(PORTABLE_FILE_VERSION) } as const;
export const PortableHouseholdSchema = HouseholdSchema.pipe(Schema.omit('conflictClocks'));
export const PortableHouseholdApplianceSchema = HouseholdApplianceSchema.pipe(
	Schema.omit('conflictClocks')
);
export const PortableRecipeSchema = RecipeAggregateSchema.pipe(Schema.omit('conflictClocks'));
export const PortableMealSchema = MealAggregateSchema.pipe(Schema.omit('conflictClocks'));
export const PortableMealCheckInSchema = MealCheckInSchema.pipe(Schema.omit('conflictClocks'));
const PortableFoodUserAliasSchema = FoodUserAliasSchema.pipe(Schema.omit('conflictClocks'));
const PortableFoodHouseholdAliasSchema = FoodHouseholdAliasSchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableFoodUserEntrySchema = FoodUserEntrySchema.pipe(Schema.omit('conflictClocks'));
const PortableFoodHouseholdEntrySchema = FoodHouseholdEntrySchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableUnitUserAliasSchema = UnitUserAliasSchema.pipe(Schema.omit('conflictClocks'));
const PortableUnitHouseholdAliasSchema = UnitHouseholdAliasSchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableUnitUserEntrySchema = UnitUserEntrySchema.pipe(Schema.omit('conflictClocks'));
const PortableUnitHouseholdEntrySchema = UnitHouseholdEntrySchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableUserFoodPreferenceSchema = UserFoodPreferenceSchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableUserFoodDisplayPreferenceSchema = UserFoodDisplayPreferenceSchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableHouseholdFoodDisplayPreferenceSchema = HouseholdFoodDisplayPreferenceSchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableUserUnitDisplayPreferenceSchema = UserUnitDisplayPreferenceSchema.pipe(
	Schema.omit('conflictClocks')
);
const PortableHouseholdUnitDisplayPreferenceSchema = HouseholdUnitDisplayPreferenceSchema.pipe(
	Schema.omit('conflictClocks')
);

export const PortableUserAttributionSchema = Schema.Struct({
	workosUserId: Schema.String.pipe(Schema.minLength(1)),
	displayName: Schema.String.pipe(Schema.minLength(1)),
	profilePictureUrl: Schema.NullOr(Schema.String)
});

export const PortableManifestSchema = Schema.Struct({
	archiveFormatVersion: Schema.Literal(1, PORTABLE_ARCHIVE_FORMAT_VERSION),
	domainContractVersion: Schema.Number.pipe(Schema.int(), Schema.positive()),
	createdAt: UtcInstantSchema,
	exporterWorkosUserId: Schema.String.pipe(Schema.minLength(1)),
	appVersion: Schema.String.pipe(Schema.minLength(1)),
	globalTaxonomySeedVersion: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	files: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			bytes: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
			count: Schema.Number.pipe(Schema.int(), Schema.nonNegative())
		})
	)
});

export const PortableUsersFileSchema = Schema.Struct({
	...FileVersionFields,
	users: Schema.Array(PortableUserAttributionSchema)
});

export const PortableHouseholdsFileSchema = Schema.Struct({
	...FileVersionFields,
	households: Schema.Array(PortableHouseholdSchema),
	appliances: Schema.Array(PortableHouseholdApplianceSchema)
});

export const PortableRecipesFileSchema = Schema.Struct({
	...FileVersionFields,
	recipes: Schema.Array(PortableRecipeSchema)
});

export const PortableMealsFileSchema = Schema.Struct({
	...FileVersionFields,
	meals: Schema.Array(PortableMealSchema)
});

export const PortableCheckInsFileSchema = Schema.Struct({
	...FileVersionFields,
	checkIns: Schema.Array(PortableMealCheckInSchema)
});

export const PortableTaxonomyFileSchema = Schema.Struct({
	...FileVersionFields,
	globalSeedVersion: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	foods: Schema.Array(FoodSchema),
	foodAliases: Schema.Array(FoodAliasSchema),
	foodUserAliases: Schema.Array(PortableFoodUserAliasSchema),
	foodHouseholdAliases: Schema.Array(PortableFoodHouseholdAliasSchema),
	foodUserEntries: Schema.Array(PortableFoodUserEntrySchema),
	foodHouseholdEntries: Schema.Array(PortableFoodHouseholdEntrySchema),
	units: Schema.Array(UnitSchema),
	unitAliases: Schema.Array(UnitAliasSchema),
	unitUserAliases: Schema.Array(PortableUnitUserAliasSchema),
	unitHouseholdAliases: Schema.Array(PortableUnitHouseholdAliasSchema),
	unitUserEntries: Schema.Array(PortableUnitUserEntrySchema),
	unitHouseholdEntries: Schema.Array(PortableUnitHouseholdEntrySchema)
});

export const PortablePreferencesFileSchema = Schema.Struct({
	...FileVersionFields,
	userFoodPreferences: Schema.Array(PortableUserFoodPreferenceSchema),
	userFoodDisplayPreferences: Schema.Array(PortableUserFoodDisplayPreferenceSchema),
	householdFoodDisplayPreferences: Schema.Array(PortableHouseholdFoodDisplayPreferenceSchema),
	userUnitDisplayPreferences: Schema.Array(PortableUserUnitDisplayPreferenceSchema),
	householdUnitDisplayPreferences: Schema.Array(PortableHouseholdUnitDisplayPreferenceSchema)
});

export const PortableDeletedRecipesFileSchema = PortableRecipesFileSchema;

export const PortableDetachedHouseholdsFileSchema = Schema.Struct({
	...FileVersionFields,
	households: Schema.Array(
		Schema.Struct({
			householdId: Schema.String,
			detachedAt: Schema.NullOr(UtcInstantSchema),
			denialCode: Schema.NullOr(Schema.String)
		})
	)
});

export type PortableManifest = typeof PortableManifestSchema.Type;
export type PortableUsersFile = typeof PortableUsersFileSchema.Type;
export type PortableHouseholdsFile = typeof PortableHouseholdsFileSchema.Type;
export type PortableRecipesFile = typeof PortableRecipesFileSchema.Type;
export type PortableMealsFile = typeof PortableMealsFileSchema.Type;
export type PortableCheckInsFile = typeof PortableCheckInsFileSchema.Type;
export type PortableTaxonomyFile = typeof PortableTaxonomyFileSchema.Type;
export type PortablePreferencesFile = typeof PortablePreferencesFileSchema.Type;
export type PortableDetachedHouseholdsFile = typeof PortableDetachedHouseholdsFileSchema.Type;

export interface PortableArchive {
	readonly manifest: PortableManifest;
	readonly users: PortableUsersFile;
	readonly households: PortableHouseholdsFile;
	readonly recipes: PortableRecipesFile;
	readonly meals: PortableMealsFile;
	readonly checkIns: PortableCheckInsFile;
	readonly taxonomy: PortableTaxonomyFile;
	readonly preferences: PortablePreferencesFile;
	readonly deletedRecipes?: PortableRecipesFile;
	readonly detachedHouseholds?: PortableDetachedHouseholdsFile;
}
