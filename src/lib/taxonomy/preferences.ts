import type { UnitPreferences } from '$lib/recipes/ingredient-text';

export type EffectiveTaxonomyPreferences = {
	locale: string;
	localeFallbacks: string[];
	unitPreferences: UnitPreferences;
	unitDisplay: Record<string, { unitId: string; alias: string; pluralAlias?: string }>;
	foodDisplay: Record<
		string,
		{ alias?: string; preferredMeasureUnitId?: string; preferredMeasureAlias?: string }
	>;
};

const fahrenheitLocales = new Set(['en-US']);

const canonicalLocale = (locale: string): string => {
	try {
		return Intl.getCanonicalLocales(locale)[0] ?? 'en-US';
	} catch {
		return 'en-US';
	}
};

export const defaultUnitPreferencesForLocale = (locale = 'en-US'): UnitPreferences => {
	const normalizedLocale = canonicalLocale(locale);
	if (fahrenheitLocales.has(normalizedLocale)) {
		return {
			preferredMassUnit: 'g',
			preferredVolumeUnit: 'ml',
			preferredTemperatureUnit: 'fahrenheit',
			preferredTemperatureUnitLabel: '°F'
		};
	}
	return {
		preferredMassUnit: 'g',
		preferredVolumeUnit: 'ml',
		preferredTemperatureUnit: 'celsius',
		preferredTemperatureUnitLabel: '°C'
	};
};

export const emptyTaxonomyPreferences = (locale = 'en-US'): EffectiveTaxonomyPreferences => ({
	locale,
	localeFallbacks: [locale],
	unitPreferences: defaultUnitPreferencesForLocale(locale),
	unitDisplay: {},
	foodDisplay: {}
});
