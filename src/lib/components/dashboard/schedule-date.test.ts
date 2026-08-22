import { describe, expect, it } from 'vitest';
import { addMonths, dateFromKey, dateKey } from './schedule-date';

describe('schedule date helpers', () => {
	it('round-trips valid date keys', () => {
		expect(dateKey(dateFromKey('2026-02-28'))).toBe('2026-02-28');
	});

	it('rejects normalized invalid date keys', () => {
		expect(() => dateFromKey('2026-02-31')).toThrow('Invalid date key');
		expect(() => dateFromKey('2026-13-01')).toThrow('Invalid date key');
	});

	it('clamps month arithmetic to the target month', () => {
		expect(dateKey(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
		expect(dateKey(addMonths(new Date(2024, 0, 31), 1))).toBe('2024-02-29');
	});
});
