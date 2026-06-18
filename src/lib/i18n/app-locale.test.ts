import { afterEach, describe, expect, it } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { baseLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	authenticatedAppPathUsesHouseholdLocale,
	paraglideLocaleFromHouseholdLocale
} from './app-locale';

afterEach(() => {
	overwriteGetLocale(() => baseLocale);
});

describe('authenticated app locale policy', () => {
	it('uses household locale only for authenticated app route segments', () => {
		expect(authenticatedAppPathUsesHouseholdLocale('/plan')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/plan/week')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/pantry')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/groceries')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/planets')).toBe(false);
		expect(authenticatedAppPathUsesHouseholdLocale('/legal')).toBe(false);
		expect(authenticatedAppPathUsesHouseholdLocale('/auth/login')).toBe(false);
	});

	it('maps household BCP-47 locales to supported Paraglide languages', () => {
		expect(paraglideLocaleFromHouseholdLocale('fr-CA')).toBe('fr');
		expect(paraglideLocaleFromHouseholdLocale('nl-NL')).toBe('nl');
		expect(paraglideLocaleFromHouseholdLocale('da-DK')).toBe('da');
		expect(paraglideLocaleFromHouseholdLocale('sv-SE')).toBe('sv');
		expect(paraglideLocaleFromHouseholdLocale('nb-NO')).toBe('no');
		expect(paraglideLocaleFromHouseholdLocale('en-US')).toBe('en');
		expect(paraglideLocaleFromHouseholdLocale('fi-FI')).toBeNull();
		expect(paraglideLocaleFromHouseholdLocale('not a locale')).toBeNull();
	});

	it('renders translated messages through Paraglide locale resolution', () => {
		overwriteGetLocale(() => 'nl');

		expect(m.hello_world({ name: 'Maal' })).toBe('Hello, Maal from nl!');
	});
});
