import type { UnitPreferences } from '$lib/recipes/ingredient-text';

export type EffectiveTaxonomyPreferences = {
	locale: string;
	localeFallbacks: string[];
	unitPreferences: UnitPreferences;
	unitDisplay: Record<string, { unitId: string; alias: string }>;
	foodDisplay: Record<
		string,
		{ alias?: string; preferredMeasureUnitId?: string; preferredMeasureAlias?: string }
	>;
};

export const emptyTaxonomyPreferences = (locale = 'en-US'): EffectiveTaxonomyPreferences => ({
	locale,
	localeFallbacks: [locale],
	unitPreferences: {},
	unitDisplay: {},
	foodDisplay: {}
});
