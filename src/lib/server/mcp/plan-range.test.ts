import { describe, expect, it, vi } from 'vitest';
import { defaultPlanRange } from './plan-range';

describe('defaultPlanRange', () => {
	it('defaults to today plus fourteen days', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
		try {
			expect(defaultPlanRange({})).toEqual({ startDate: '2026-02-01', endDate: '2026-02-15' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('derives missing end date from start date', () => {
		expect(defaultPlanRange({ startDate: '2026-03-01' })).toEqual({
			startDate: '2026-03-01',
			endDate: '2026-03-15'
		});
	});

	it('derives missing start date from end date', () => {
		expect(defaultPlanRange({ endDate: '2026-03-15' })).toEqual({
			startDate: '2026-03-01',
			endDate: '2026-03-15'
		});
	});

	it('clamps long ranges to sixty-two days', () => {
		expect(defaultPlanRange({ startDate: '2026-01-01', endDate: '2026-12-31' })).toEqual({
			startDate: '2026-01-01',
			endDate: '2026-03-04'
		});
	});
});


it('rejects invalid or reversed explicit date ranges', () => {
	expect(() => defaultPlanRange({ startDate: 'not-a-date' })).toThrow(
		expect.objectContaining({ code: 'invalid_input' })
	);
	expect(() => defaultPlanRange({ endDate: 'not-a-date' })).toThrow(
		expect.objectContaining({ code: 'invalid_input' })
	);
	expect(() => defaultPlanRange({ startDate: '2026-03-02', endDate: '2026-03-01' })).toThrow(
		expect.objectContaining({ code: 'invalid_input' })
	);
});
