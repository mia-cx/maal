import { describe, expect, it, vi } from 'vitest';
import {
	asWeekStartDay,
	defaultLocale,
	inviteExpiryFromForm,
	localeFallbacks,
	localeFromForm,
	numberFromForm,
	timeFromForm,
	timezoneFromForm,
	weekStartDay,
	weekStartValue
} from './settings-parsing';

describe('household settings parsing', () => {
	it('parses week start values', () => {
		expect(asWeekStartDay('sunday')).toBe('sunday');
		expect(asWeekStartDay('bad')).toBe('monday');
		expect(weekStartDay(0)).toBe('sunday');
		expect(weekStartDay(1)).toBe('monday');
		expect(weekStartValue('sunday')).toBe(0);
		expect(weekStartValue('monday')).toBe(1);
	});

	it('normalizes locales', () => {
		expect(localeFromForm(' fr-ca ')).toBe('fr-CA');
		expect(localeFromForm('')).toBe(defaultLocale);
		expect(localeFromForm('not a locale')).toBeUndefined();
		expect(localeFallbacks('fr-CA')).toEqual(['fr-CA', 'fr', defaultLocale]);
		expect(localeFallbacks('not a locale')).toEqual([defaultLocale]);
	});

	it('validates timezones and times', () => {
		expect(timezoneFromForm('UTC')).toBe('UTC');
		expect(timezoneFromForm('')).toBeNull();
		expect(timezoneFromForm('Nope/Nowhere')).toBeUndefined();
		expect(timeFromForm('18:30')).toBe('18:30');
		expect(timeFromForm('6:30')).toBeNull();
	});

	it('parses numbers with fallbacks', () => {
		expect(numberFromForm('12', 1)).toBe(12);
		expect(numberFromForm('bad', 4)).toBe(4);
	});

	it('parses invite expiry days', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-14T00:00:00Z'));
		expect(inviteExpiryFromForm('1')).toBe('2026-06-15T00:00:00.000Z');
		expect(inviteExpiryFromForm('999')).toBe('2026-06-21T00:00:00.000Z');
		vi.useRealTimers();
	});
});
