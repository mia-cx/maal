import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadEffectiveTaxonomyPreferences = vi.fn();

vi.mock('$lib/server/taxonomy/effective-preferences', () => ({ loadEffectiveTaxonomyPreferences }));

const { loadHouseholdTaxonomyPreferences } = await import('./household-preferences');

const localeRows = vi.fn();
const db = {
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({ limit: localeRows }))
		}))
	}))
};

describe('loadHouseholdTaxonomyPreferences', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localeRows.mockResolvedValue([{ locale: 'nl-NL' }]);
		loadEffectiveTaxonomyPreferences.mockResolvedValue({ unitPreferences: {} });
	});

	it('uses the household locale when no request locale is provided', async () => {
		await loadHouseholdTaxonomyPreferences(db as never, {
			workosUserId: 'user_1',
			householdId: 'household_1'
		});

		expect(localeRows).toHaveBeenCalledTimes(1);
		expect(loadEffectiveTaxonomyPreferences).toHaveBeenCalledWith(db, {
			workosUserId: 'user_1',
			householdId: 'household_1',
			locale: 'nl-NL'
		});
	});

	it('falls back to the default locale when the household row is missing', async () => {
		localeRows.mockResolvedValue([]);

		await loadHouseholdTaxonomyPreferences(db as never, {
			workosUserId: 'user_1',
			householdId: 'household_1'
		});

		expect(localeRows).toHaveBeenCalledTimes(1);
		expect(loadEffectiveTaxonomyPreferences).toHaveBeenCalledWith(db, {
			workosUserId: 'user_1',
			householdId: 'household_1',
			locale: 'en-US'
		});
	});

	it('uses an explicit locale without querying the household row', async () => {
		await loadHouseholdTaxonomyPreferences(db as never, {
			workosUserId: 'user_1',
			householdId: 'household_1',
			locale: 'en-GB'
		});

		expect(localeRows).not.toHaveBeenCalled();
		expect(loadEffectiveTaxonomyPreferences).toHaveBeenCalledWith(db, {
			workosUserId: 'user_1',
			householdId: 'household_1',
			locale: 'en-GB'
		});
	});
});
