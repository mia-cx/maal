import { describe, expect, it } from 'vitest';
import { boundedPagination } from './pagination';

describe('boundedPagination', () => {
	it('uses default values when input is missing', () => {
		expect(boundedPagination({}, 25, 60)).toEqual({ offset: 0, limit: 25 });
	});

	it('floors fractional values', () => {
		expect(boundedPagination({ offset: 2.9, limit: 10.8 }, 25, 60)).toEqual({
			offset: 2,
			limit: 10
		});
	});

	it('clamps lower bounds', () => {
		expect(boundedPagination({ offset: -10, limit: 0 }, 25, 60)).toEqual({
			offset: 0,
			limit: 1
		});
	});

	it('clamps the maximum limit', () => {
		expect(boundedPagination({ offset: 1, limit: 500 }, 25, 60)).toEqual({
			offset: 1,
			limit: 60
		});
	});

	it('ignores non-finite values', () => {
		expect(boundedPagination({ offset: Number.NaN, limit: Infinity }, 25, 60)).toEqual({
			offset: 0,
			limit: 25
		});
	});
});
