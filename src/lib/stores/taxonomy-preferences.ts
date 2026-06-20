import { atom, computed } from 'nanostores';
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

export const refreshTaxonomyPreferences = async () => taxonomyPreferencesStore.get();
