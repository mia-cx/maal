import {
	HouseholdApplianceSchema,
	HouseholdSchema,
	MembershipSchema
} from '$lib/domain/household/contracts.js';
import { MealCheckInSchema, StoredMealSchema } from '$lib/domain/meals/schema.js';
import { PortableUserAttributionSchema } from '$lib/domain/portability/schema.js';
import { StoredRecipeSchema } from '$lib/domain/recipes/schema.js';
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

import { exportDecodableRecoveryData, type RecoveryDecoders } from './recovery.js';

const recoveryDecoders = {
	households: HouseholdSchema,
	memberships: MembershipSchema,
	householdAppliances: HouseholdApplianceSchema,
	userAttributions: PortableUserAttributionSchema,
	recipes: StoredRecipeSchema,
	meals: StoredMealSchema,
	mealCheckIns: MealCheckInSchema,
	foods: FoodSchema,
	foodAliases: FoodAliasSchema,
	foodUserAliases: FoodUserAliasSchema,
	foodHouseholdAliases: FoodHouseholdAliasSchema,
	foodUserEntries: FoodUserEntrySchema,
	foodHouseholdEntries: FoodHouseholdEntrySchema,
	units: UnitSchema,
	unitAliases: UnitAliasSchema,
	unitUserAliases: UnitUserAliasSchema,
	unitHouseholdAliases: UnitHouseholdAliasSchema,
	unitUserEntries: UnitUserEntrySchema,
	unitHouseholdEntries: UnitHouseholdEntrySchema,
	userFoodPreferences: UserFoodPreferenceSchema,
	userFoodDisplayPreferences: UserFoodDisplayPreferenceSchema,
	householdFoodDisplayPreferences: HouseholdFoodDisplayPreferenceSchema,
	userUnitDisplayPreferences: UserUnitDisplayPreferenceSchema,
	householdUnitDisplayPreferences: HouseholdUnitDisplayPreferenceSchema
} satisfies RecoveryDecoders;

export const exportSafeRecoveryData = async (
	database: Parameters<typeof exportDecodableRecoveryData>[0]
) => exportDecodableRecoveryData(database, recoveryDecoders);
