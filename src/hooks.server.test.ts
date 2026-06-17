import { describe, expect, it } from 'vitest';
import {
	authenticatedAppPathUsesHouseholdLocale,
	paraglideLocaleFromHouseholdLocale
} from '$lib/i18n/app-locale';
import { subscriptionExemptPath } from './hooks.server';

describe('subscriptionExemptPath', () => {
	it('keeps household management reachable while premium routes are locked', () => {
		expect(subscriptionExemptPath('/household')).toBe(true);
		expect(subscriptionExemptPath('/household/members')).toBe(true);
		expect(subscriptionExemptPath('/menu')).toBe(false);
	});
});

describe('authenticated app locale policy', () => {
	it('uses household locale only for authenticated app surfaces', () => {
		expect(authenticatedAppPathUsesHouseholdLocale('/plan')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/household')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/settings/security')).toBe(true);
		expect(authenticatedAppPathUsesHouseholdLocale('/legal')).toBe(false);
		expect(authenticatedAppPathUsesHouseholdLocale('/auth/login')).toBe(false);
	});

	it('maps household BCP-47 locales to supported Paraglide languages', () => {
		expect(paraglideLocaleFromHouseholdLocale('fr-CA')).toBe('fr');
		expect(paraglideLocaleFromHouseholdLocale('nl-NL')).toBe('nl');
		expect(paraglideLocaleFromHouseholdLocale('en-US')).toBe('en');
		expect(paraglideLocaleFromHouseholdLocale('fi-FI')).toBeNull();
		expect(paraglideLocaleFromHouseholdLocale('not a locale')).toBeNull();
	});
});
