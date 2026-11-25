import { derived, writable } from 'svelte/store';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { createTaxonomyPreferencesLiveQuery } from '$lib/client/taxonomy/live.js';
import { loadEffectiveTaxonomyPreferences } from '$lib/client/taxonomy/queries.js';
import {
	emptyTaxonomyPreferences,
	type EffectiveTaxonomyPreferences
} from '$lib/taxonomy/preferences.js';

export const taxonomyPreferencesStore = writable<EffectiveTaxonomyPreferences>(
	emptyTaxonomyPreferences()
);

export const unitPreferencesStore = derived(
	taxonomyPreferencesStore,
	(preferences) => preferences.unitPreferences
);

export const hydrateTaxonomyPreferences = (
	preferences: EffectiveTaxonomyPreferences | null | undefined
): void => {
	taxonomyPreferencesStore.set(preferences ?? emptyTaxonomyPreferences());
};

let activeBinding:
	| {
			database: MaalDatabase;
			params: { workosUserId: string; householdId: string; locale: string };
	  }
	| undefined;

export const bindTaxonomyPreferences = (
	database: MaalDatabase,
	params: { workosUserId: string; householdId: string; locale: string }
): (() => void) => {
	activeBinding = { database, params };
	const unsubscribe = createTaxonomyPreferencesLiveQuery(database, params).subscribe(
		taxonomyPreferencesStore.set
	);
	return () => {
		unsubscribe();
		if (activeBinding?.database === database) activeBinding = undefined;
	};
};

export const refreshTaxonomyPreferences = async (): Promise<EffectiveTaxonomyPreferences> => {
	if (!activeBinding) return emptyTaxonomyPreferences();
	const preferences = await loadEffectiveTaxonomyPreferences(
		activeBinding.database,
		activeBinding.params
	);
	hydrateTaxonomyPreferences(preferences);
	return preferences;
};
