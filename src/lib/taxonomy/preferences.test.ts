import { describe, expect, it } from 'vitest';
import { defaultUnitPreferencesForLocale, emptyTaxonomyPreferences } from './preferences';

describe('taxonomy preference defaults', () => {
	it('defaults en-US temperatures to fahrenheit', () => {
		expect(defaultUnitPreferencesForLocale('en-US')).toMatchObject({
			preferredTemperatureUnit: 'fahrenheit',
			preferredTemperatureUnitLabel: '°F'
		});
		expect(emptyTaxonomyPreferences('en-US').unitPreferences).toMatchObject({
			preferredTemperatureUnit: 'fahrenheit',
			preferredTemperatureUnitLabel: '°F'
		});
	});

	it('defaults non-US locales to celsius', () => {
		expect(defaultUnitPreferencesForLocale('en-GB')).toMatchObject({
			preferredTemperatureUnit: 'celsius',
			preferredTemperatureUnitLabel: '°C'
		});
	});
});
