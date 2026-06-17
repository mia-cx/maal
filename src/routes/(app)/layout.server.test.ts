import { describe, expect, it, vi } from 'vitest';
import { createAuthSession } from '$lib/server/auth/session-test-fixtures';

const mocks = vi.hoisted(() => ({
	canManageActiveHousehold: vi.fn(),
	listUserHouseholds: vi.fn(),
	resolveActiveHouseholdId: vi.fn(),
	hasHouseholdBillingGrant: vi.fn(),
	loadFreshBillingStatus: vi.fn()
}));

vi.mock('$lib/server/auth/household', () => ({
	canManageActiveHousehold: mocks.canManageActiveHousehold,
	listUserHouseholds: mocks.listUserHouseholds,
	resolveActiveHouseholdId: mocks.resolveActiveHouseholdId
}));
vi.mock('$lib/server/domains/billing', () => ({
	hasHouseholdBillingGrant: mocks.hasHouseholdBillingGrant,
	loadFreshBillingStatus: mocks.loadFreshBillingStatus
}));

const { load } = await import('./+layout.server');

const session = createAuthSession();
const event = {
	cookies: {},
	locals: { session },
	platform: { env: { DB: {} as D1Database } } as App.Platform,
	url: new URL('https://maal.test/plan')
};

describe('app layout load', () => {
	it('fails loudly when household listing fails', async () => {
		mocks.listUserHouseholds.mockRejectedValue(new Error('WorkOS unavailable'));

		await expect(load(event as never)).rejects.toMatchObject({
			status: 503,
			body: { message: 'Could not load your households. Try again in a moment.' }
		});
		expect(mocks.resolveActiveHouseholdId).not.toHaveBeenCalled();
	});
});
