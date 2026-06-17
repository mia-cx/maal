import { describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const mocks = vi.hoisted(() => ({
	canManageActiveHousehold: vi.fn(),
	listUserHouseholds: vi.fn(),
	resolveActiveHouseholdId: vi.fn(),
	createStripeClient: vi.fn(),
	getStripeProductId: vi.fn(),
	listActiveProductPrices: vi.fn(),
	loadFreshBillingStatus: vi.fn(),
	loadTrialAvailability: vi.fn(),
	pricingOptionsFromPrices: vi.fn(),
	trialDefaultPricingOptionFromPrices: vi.fn()
}));

vi.mock('$lib/server/auth/household', () => ({
	canManageActiveHousehold: mocks.canManageActiveHousehold,
	listUserHouseholds: mocks.listUserHouseholds,
	resolveActiveHouseholdId: mocks.resolveActiveHouseholdId
}));
vi.mock('$lib/server/domains/billing', () => ({
	createStripeClient: mocks.createStripeClient,
	getStripeProductId: mocks.getStripeProductId,
	listActiveProductPrices: mocks.listActiveProductPrices,
	loadFreshBillingStatus: mocks.loadFreshBillingStatus,
	loadTrialAvailability: mocks.loadTrialAvailability,
	pricingOptionsFromPrices: mocks.pricingOptionsFromPrices,
	trialDefaultPricingOptionFromPrices: mocks.trialDefaultPricingOptionFromPrices
}));

const { load } = await import('./+page.server');

const session = createAuthSession();
const event = {
	cookies: {},
	locals: { session },
	platform: { env: { DB: {} as D1Database } } as App.Platform,
	url: new URL('https://maal.test/subscribe')
};

describe('subscribe page load', () => {
	it('fails loudly when household listing fails', async () => {
		mocks.resolveActiveHouseholdId.mockResolvedValue({ householdId: 'household_1' });
		mocks.loadFreshBillingStatus.mockResolvedValue({ isPaid: false });
		mocks.canManageActiveHousehold.mockResolvedValue(true);
		mocks.listUserHouseholds.mockRejectedValue(new Error('WorkOS unavailable'));

		await expect(load(event as never)).rejects.toMatchObject({
			status: 503,
			body: { message: 'Could not load your households. Try again in a moment.' }
		});
		expect(mocks.createStripeClient).not.toHaveBeenCalled();
	});
});
