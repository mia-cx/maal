import type { EffectiveTaxonomyPreferences } from '$lib/taxonomy/preferences';

export const syncTaxonomyPreferencesFromRemote =
	async (): Promise<EffectiveTaxonomyPreferences> => {
		const response = await fetch('/api/taxonomy/preferences');
		if (!response.ok) throw new Error(await response.text());
		return (await response.json()) as EffectiveTaxonomyPreferences;
	};
