import { describe, expect, it } from 'vitest';
import { selectActiveHouseholdId } from './household';

describe('selectActiveHouseholdId', () => {
	const householdIds = ['mia-kitchen', 'new-household', 'shared-household'];

	it('prefers a valid household cookie', () => {
		expect(
			selectActiveHouseholdId({
				cookieHouseholdId: 'shared-household',
				householdIds
			})
		).toBe('shared-household');
	});

	it('ignores inaccessible household cookies', () => {
		expect(
			selectActiveHouseholdId({
				cookieHouseholdId: 'not-mine',
				householdIds
			})
		).toBe('mia-kitchen');
	});

	it('falls back to the first accessible household', () => {
		expect(selectActiveHouseholdId({ householdIds })).toBe('mia-kitchen');
		expect(selectActiveHouseholdId({ householdIds: [] })).toBeNull();
	});
});
