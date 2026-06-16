import { describe, expect, it } from 'vitest';
import { arrayOfStrings, isRecord, optionalNumber, requireNonEmptyText } from './scalars';

describe('MCP scalar helpers', () => {
	it('only treats plain objects as records', () => {
		expect(isRecord({ ok: true })).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
	});

	it('accepts finite numbers and numeric strings only', () => {
		expect(optionalNumber(3, 'servingsPlanned')).toBe(3);
		expect(optionalNumber('4', 'servingsPlanned')).toBe(4);
		expect(optionalNumber(undefined, 'servingsPlanned')).toBeUndefined();
		for (const value of [true, '', null, Number.POSITIVE_INFINITY, 'many']) {
			expect(() => optionalNumber(value, 'servingsPlanned')).toThrow(
				expect.objectContaining({
					code: 'invalid_input',
					message: 'servingsPlanned must be a finite number.'
				})
			);
		}
	});

	it('rejects empty required text and heterogeneous string arrays', () => {
		expect(() => requireNonEmptyText(' ', 'mealId')).toThrow(
			expect.objectContaining({ code: 'invalid_input' })
		);
		expect(() => arrayOfStrings(['ok', 1], 'ingredients')).toThrow(
			expect.objectContaining({ code: 'invalid_input' })
		);
	});
});
