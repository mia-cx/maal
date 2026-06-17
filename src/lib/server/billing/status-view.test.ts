import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBillingStatusView } from './status-view';

const mocks = vi.hoisted(() => ({
	canManageActiveHousehold: vi.fn(),
	listUserHouseholds: vi.fn(),
	loadFreshBillingStatus: vi.fn(),
	resolveActiveHouseholdId: vi.fn()
}));

vi.mock('$lib/server/auth/household', () => ({
	canManageActiveHousehold: mocks.canManageActiveHousehold,
	listUserHouseholds: mocks.listUserHouseholds,
	resolveActiveHouseholdId: mocks.resolveActiveHouseholdId
}));

vi.mock('./stripe', () => ({
	getStripePublicConfig: () => ({ publishableKey: 'pk_test', pricingTableId: 'ptable_test' })
}));

vi.mock('./subscriptions', () => ({
	loadBillingStatus: vi.fn(),
	loadFreshBillingStatus: mocks.loadFreshBillingStatus
}));

const session = {
	user: { id: 'user_1', email: 'cook@maal.test' }
} as never;

const cookies = {} as never;
const url = new URL('https://maal.test/plan?settings=billing');
const platform = { env: { DB: {} } } as App.Platform;

const billingStatus = {
	householdId: 'household_1',
	stripeCustomerId: null,
	subscriberUserId: null,
	stripeSubscriptionId: null,
	stripePriceId: null,
	status: null,
	currentPeriodEnd: null,
	cancelAtPeriodEnd: false,
	isPaid: false
};

describe('loadBillingStatusView', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.resolveActiveHouseholdId.mockResolvedValue({ householdId: 'household_1' });
		mocks.loadFreshBillingStatus.mockResolvedValue(billingStatus);
		mocks.canManageActiveHousehold.mockResolvedValue(true);
	});

	it('marks the view as degraded when household listing fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mocks.listUserHouseholds.mockRejectedValue(new Error('household service unavailable'));

		await expect(loadBillingStatusView({ cookies, platform, session, url })).resolves.toMatchObject({
			householdId: 'household_1',
			householdName: 'Current household',
			householdBilling: [],
			householdListDegraded: true
		});
	});

	it('keeps household billing context when household listing succeeds', async () => {
		mocks.listUserHouseholds.mockResolvedValue([{ id: 'household_1', name: 'Family' }]);

		await expect(loadBillingStatusView({ cookies, platform, session, url })).resolves.toMatchObject({
			householdName: 'Family',
			householdListDegraded: false,
			householdBilling: [{ householdId: 'household_1', householdName: 'Family' }]
		});
	});
});
