import { eq } from 'drizzle-orm';
import type { UnitPreferences } from '$lib/recipes/ingredient-text';
import type { EffectiveTaxonomyPreferences } from '$lib/taxonomy/preferences';
import { getDb } from '$lib/server/db';
import { households } from '$lib/server/db/schema';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';

export type TaxonomyPreferenceDb = ReturnType<typeof getDb>;

export const defaultUnitPreferences: UnitPreferences = {
	preferredMassUnit: 'g',
	preferredVolumeUnit: 'ml',
	preferredTemperatureUnit: 'celsius',
	preferredTemperatureUnitLabel: '°C'
};

export const loadHouseholdTaxonomyPreferences = async (
	db: TaxonomyPreferenceDb,
	input: { workosUserId: string; householdId: string; locale?: string | null }
): Promise<EffectiveTaxonomyPreferences> => {
	const profileRows = input.locale
		? []
		: await db
				.select({ locale: households.locale })
				.from(households)
				.where(eq(households.householdId, input.householdId))
				.limit(1);

	return loadEffectiveTaxonomyPreferences(db, {
		workosUserId: input.workosUserId,
		householdId: input.householdId,
		locale: input.locale ?? profileRows[0]?.locale ?? 'en-US'
	});
};

export const loadHouseholdUnitPreferences = async (
	db: TaxonomyPreferenceDb,
	input: { workosUserId: string; householdId?: string | null; fallback?: UnitPreferences }
): Promise<UnitPreferences> => {
	if (!input.householdId) return input.fallback ?? {};
	return (
		await loadHouseholdTaxonomyPreferences(db, {
			workosUserId: input.workosUserId,
			householdId: input.householdId
		})
	).unitPreferences;
};
