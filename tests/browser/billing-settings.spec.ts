import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import BillingSettingsSection from '$lib/components/settings/billing-settings-section.svelte';
import type { BillingCapability } from '$lib/domain/billing/contracts.js';
import type { HouseholdPermission } from '$lib/domain/household/contracts.js';
import '../../src/routes/layout.css';

const timestamp = '2026-08-21T12:00:00.000Z';
const databases: MaalDatabase[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

const paidCapability: BillingCapability = {
	householdId: 'org_kitchen',
	state: 'enabled',
	stripeStatus: 'active',
	subscriberUserId: 'user_alice',
	stripePriceId: 'price_monthly',
	currentPeriodEnd: '2026-09-21T12:00:00.000Z',
	interruptionStartedAt: null,
	graceUntil: null,
	validUntil: '2026-09-21T12:00:00.000Z',
	cancelAtPeriodEnd: false,
	stale: false,
	source: 'stripe-d1'
};

/** Renders the section for Bob, signed in with the given household permissions. */
const renderForBob = async (
	permissions: readonly HouseholdPermission[],
	capability: BillingCapability | null
) => {
	const database = await openMaalDatabase(`billing-settings-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	await database.authSlots.put({
		authSlotId: 'b'.repeat(32),
		profileId,
		workosUserId: 'user_bob',
		sessionState: 'authenticated',
		lastRefreshedAt: null,
		lastVerifiedAt: null,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.memberships.put({
		membershipId: 'membership_bob',
		householdId: 'org_kitchen',
		workosUserId: 'user_bob',
		roleSlug: permissions.includes('households:write') ? 'admin' : 'member',
		permissions: [...permissions],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: timestamp,
		lastVerifiedAt: timestamp,
		updatedAt: timestamp,
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
	if (capability) await database.billingCapabilities.put(capability);
	return render(BillingSettingsSection, {
		database,
		profileId,
		householdId: 'org_kitchen',
		householdName: 'Kitchen',
		workosUserId: 'user_bob',
		localOnly: false,
		transferCandidates: []
	});
};

test('offers the billing portal to a billing owner whose plan lapsed', async () => {
	const screen = await renderForBob(['households:write', 'meals:read'], {
		...paidCapability,
		state: 'disabled',
		stripeStatus: 'canceled',
		subscriberUserId: 'user_bob',
		validUntil: null
	});

	await expect.element(screen.getByText('No active plan')).toBeVisible();
	await expect.element(screen.getByRole('button', { name: /Manage subscription/ })).toBeVisible();
});

test('lets a member refresh plan status without offering checkout', async () => {
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({
			schemaVersion: 1,
			capability: paidCapability,
			prices: [
				{
					id: 'price_monthly',
					lookupKey: 'maal_monthly_v1',
					amountMinor: 500,
					currency: 'eur',
					interval: 'month',
					intervalCount: 1
				}
			],
			trialAvailable: false,
			trialUnavailableReason: 'already_subscribed',
			refreshedAt: timestamp
		})
	);
	vi.stubGlobal('fetch', fetcher);
	const screen = await renderForBob(['meals:read', 'meals:write'], null);

	await expect.element(screen.getByText('No active plan')).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'See plans' })).not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Refresh' }).click();

	await expect.element(screen.getByText('Active', { exact: true })).toBeVisible();
	expect(fetcher).toHaveBeenCalledOnce();
	expect(String(fetcher.mock.calls[0]?.[0])).toContain('/billing/status?householdId=org_kitchen');
});
