import { atom, computed } from 'nanostores';
import { syncTaxonomyPreferencesFromRemote } from '$lib/client-db/taxonomy-sync';
import {
	emptyTaxonomyPreferences,
	type EffectiveTaxonomyPreferences
} from '$lib/taxonomy/preferences';

export const taxonomyPreferencesStore = atom<EffectiveTaxonomyPreferences>(
	emptyTaxonomyPreferences()
);

export const unitPreferencesStore = computed(
	taxonomyPreferencesStore,
	(preferences) => preferences.unitPreferences
);

export const hydrateTaxonomyPreferences = (
	preferences: EffectiveTaxonomyPreferences | null | undefined
) => {
	taxonomyPreferencesStore.set(preferences ?? emptyTaxonomyPreferences());
};

export const refreshTaxonomyPreferences = async () => {
	const preferences = await syncTaxonomyPreferencesFromRemote();
	hydrateTaxonomyPreferences(preferences);
	return preferences;
};
