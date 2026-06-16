import { describe, expect, it } from 'vitest';
import { filterHouseholdsForScope } from './household-tools';

const households = [
	{ id: 'household-1', name: 'Kitchen' },
	{ id: 'household-2', name: 'Cabin' },
	{ id: 'household-3', name: 'Studio' }
];

describe('filterHouseholdsForScope', () => {
	it('keeps every household for all-household keys', () => {
		expect(filterHouseholdsForScope(households, { kind: 'all' })).toEqual(households);
	});

	it('hides households outside selected MCP key scope', () => {
		expect(
			filterHouseholdsForScope(households, {
				kind: 'households',
				householdIds: ['household-2']
			})
		).toEqual([{ id: 'household-2', name: 'Cabin' }]);
	});
});
