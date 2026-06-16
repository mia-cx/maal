import { describe, expect, it } from 'vitest';
import { normalizeServingsPlanned } from './planned-servings';

describe('normalizeServingsPlanned', () => {
	it.each([
		[undefined, 4, 4],
		[null, 3, 3],
		[2.4, 1, 2],
		[2.5, 1, 3],
		[0, 4, 1],
		[-5, 4, 1],
		[Number.POSITIVE_INFINITY, 4, 1],
		[6, 1, 6]
	])('normalizes %s with default %s to %s', (servingsPlanned, defaultServings, expected) => {
		expect(normalizeServingsPlanned({ servingsPlanned }, defaultServings)).toBe(expected);
	});
});
