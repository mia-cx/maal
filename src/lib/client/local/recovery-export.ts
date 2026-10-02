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

import {
	PORTABLE_SOURCE_STORES,
	buildPortableArchive,
	createPortableArchiveBlob,
	type PortableSource,
	type PortableUserAttribution
} from '$lib/client/portability/archive.js';

import {
	exportDecodableRecoveryData,
	type RecoveryDecoders,
	type RecoveryExport
} from './recovery.js';

const recoveryDecoders = {
	// The attribution schema keeps only display fields, so PIN material never leaves the table.
	profiles: PortableUserAttributionSchema,
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

export interface RecoveryArchive {
	readonly workosUserId: string;
	readonly displayName: string;
	readonly blob: Blob;
}

export interface RecoveryArchiveExport {
	readonly archives: readonly RecoveryArchive[];
	readonly skipped: RecoveryExport['skipped'];
	readonly unreadable: RecoveryExport['unreadable'];
}

/**
 * Builds one portable archive per user with readable data, from the rows that still decode.
 * The importer accepts these after a reset. A profile row that no longer decodes does not hide
 * the recipes its user owns.
 */
export const exportRecoveryArchives = async (
	database: Parameters<typeof exportDecodableRecoveryData>[0]
): Promise<RecoveryArchiveExport> => {
	const recovery = await exportDecodableRecoveryData(database, recoveryDecoders);
	// Every list was decoded with its own store's schema, so it has that store's row shape.
	const source = Object.fromEntries(
		PORTABLE_SOURCE_STORES.map((store) => [store, recovery.records[store] ?? []])
	) as PortableSource;
	const profiles = (recovery.records.profiles ?? []) as PortableUserAttribution[];
	const exporters = new Map(profiles.map((profile) => [profile.workosUserId, profile]));
	const cached = new Map(source.userAttributions.map((user) => [user.workosUserId, user]));
	// Recipes sync only to their owner, so their owners are this device's users. Memberships are
	// not a signal: they also cache every other member of a household.
	for (const { ownerUserId: owner } of source.recipes) {
		if (typeof owner !== 'string' || exporters.has(owner)) continue;
		exporters.set(
			owner,
			cached.get(owner) ?? { workosUserId: owner, displayName: owner, profilePictureUrl: null }
		);
	}
	const createdAt = recovery.createdAt as `${string}Z`;
	const archives = await Promise.all(
		[...exporters.values()].map(async (exporter) => ({
			workosUserId: exporter.workosUserId,
			displayName: exporter.displayName,
			blob: await createPortableArchiveBlob(
				buildPortableArchive(source, exporter, profiles, { createdAt })
			)
		}))
	);
	return { archives, skipped: recovery.skipped, unreadable: recovery.unreadable };
};
