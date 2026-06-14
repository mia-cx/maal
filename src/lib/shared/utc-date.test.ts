import { describe, expect, it } from 'vitest';
import { addUtcDays, dateKey, utcDateFromKey, utcDaysBetween } from './utc-date';

describe('UTC date helpers', () => {
	it('formats ISO date keys', () => {
		expect(dateKey(new Date('2026-06-14T23:59:59Z'))).toBe('2026-06-14');
	});

	it('parses date keys at UTC midnight', () => {
		expect(utcDateFromKey('2026-06-14').toISOString()).toBe('2026-06-14T00:00:00.000Z');
	});

	it('adds days in UTC', () => {
		expect(dateKey(addUtcDays(new Date('2026-03-08T00:00:00Z'), 1))).toBe('2026-03-09');
	});

	it('calculates day spans without local timezone effects', () => {
		expect(utcDaysBetween('2026-03-08', '2026-03-10')).toBe(2);
	});
});
