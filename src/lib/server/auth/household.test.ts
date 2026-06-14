import { describe, expect, it } from 'vitest';
import { selectActiveHouseholdId } from './household';

describe('selectActiveHouseholdId', () => {
	const householdIds = ['mia-kitchen', 'new-household', 'shared-household'];

	it('prefers an explicit requested household over cookie and session organization', () => {
		expect(
			selectActiveHouseholdId({
				requestedHouseholdId: 'new-household',
				cookieHouseholdId: 'mia-kitchen',
				sessionOrganizationId: 'mia-kitchen',
				householdIds
			})
		).toBe('new-household');
	});

	it('prefers a valid cookie over a stale session organization', () => {
		expect(
			selectActiveHouseholdId({
				cookieHouseholdId: 'shared-household',
				sessionOrganizationId: 'mia-kitchen',
				householdIds
			})
		).toBe('shared-household');
	});

	it('ignores inaccessible requested and cookie households', () => {
		expect(
			selectActiveHouseholdId({
				requestedHouseholdId: 'not-mine',
				cookieHouseholdId: 'also-not-mine',
				sessionOrganizationId: 'mia-kitchen',
				householdIds
			})
		).toBe('mia-kitchen');
	});

	it('falls back to the first accessible household', () => {
		expect(selectActiveHouseholdId({ householdIds })).toBe('mia-kitchen');
		expect(selectActiveHouseholdId({ householdIds: [] })).toBeNull();
	});
});
