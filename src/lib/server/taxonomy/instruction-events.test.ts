import { describe, expect, it } from 'vitest';
import { uniqueInstructionEvents, type ParsedInstructionEvent } from './instruction-events';

const event = (overrides: Partial<ParsedInstructionEvent> = {}): ParsedInstructionEvent => ({
	instructionId: 'instruction_1',
	kind: 'temperature',
	sourceText: '350 °F',
	value: 350,
	unitId: 'fahrenheit',
	baseValue: 176.66666666666669,
	baseUnitId: 'celsius',
	confidence: 0.9,
	...overrides
});

describe('instruction event helpers', () => {
	it('deduplicates repeated parsed events by their stable event identity', () => {
		expect(uniqueInstructionEvents([event(), event()])).toEqual([event()]);
	});

	it('keeps distinct events for the same instruction', () => {
		const first = event({ sourceText: '350 °F', value: 350 });
		const second = event({ sourceText: '375 °F', value: 375, baseValue: 190.55555555555557 });

		expect(uniqueInstructionEvents([first, second])).toEqual([first, second]);
	});
});
