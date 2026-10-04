import { describe, expect, it } from 'vitest';
import { hasLoadedMealRange, missingMealRanges } from './schedule-ranges';

describe('schedule ranges', () => {
	it('detects loaded containing ranges', () => {
		expect(
			hasLoadedMealRange([{ start: '2026-06-01', end: '2026-06-10' }], '2026-06-02', '2026-06-09')
		).toBe(true);
		expect(
			hasLoadedMealRange([{ start: '2026-06-03', end: '2026-06-10' }], '2026-06-02', '2026-06-09')
		).toBe(false);
	});

	it('returns the full range when nothing overlaps', () => {
		expect(missingMealRanges([], { start: '2026-06-01', end: '2026-06-03' })).toEqual([
			{ start: '2026-06-01', end: '2026-06-03' }
		]);
	});

	it('finds gaps around loaded segments', () => {
		expect(
			missingMealRanges(
				[
					{ start: '2026-06-02', end: '2026-06-03' },
					{ start: '2026-06-05', end: '2026-06-05' }
				],
				{ start: '2026-06-01', end: '2026-06-06' }
			)
		).toEqual([
			{ start: '2026-06-01', end: '2026-06-01' },
			{ start: '2026-06-04', end: '2026-06-04' },
			{ start: '2026-06-06', end: '2026-06-06' }
		]);
	});
});
