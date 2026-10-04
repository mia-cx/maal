import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';

import {
	applyBillingProjection,
	refreshBillingOnLoad,
	refreshBillingProjectionsOnLaunch,
	refreshBillingProjection,
	requestHouseholdDeletion,
	shouldRefreshBillingOnLaunch
} from '$lib/client/billing.js';
import { joinRemoteHousehold } from '$lib/client/household-administration.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/index.js';
import { resolveLocalUserSyncCapability } from '$lib/client/sync/capability.js';
import { resolveLocalHouseholdSyncCapability } from '$lib/client/sync/household-capability.js';
import type {
	BillingCapability,
	BillingProjectionEnvelope
} from '$lib/domain/billing/contracts.js';
import type { Membership } from '$lib/domain/household/contracts.js';

let database: MaalDatabase | null = null;

afterEach(async () => {
	if (!database) return;
	const name = database.name;
	database.close();
	await Dexie.delete(name);
	database = null;
});

const projection = (stale = false): BillingProjectionEnvelope => ({
	schemaVersion: 1,
	capability: {
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
		stale,
		source: 'stripe-d1'
	},
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
	refreshedAt: '2026-08-21T12:00:00.000Z'
});

const neverPaid = (householdId: string): BillingCapability => ({
	householdId,
	state: 'disabled',
	stripeStatus: null,
	subscriberUserId: null,
	stripePriceId: null,
	currentPeriodEnd: null,
	interruptionStartedAt: null,
	graceUntil: null,
	validUntil: null,
	cancelAtPeriodEnd: false,
	stale: false,
	source: 'stripe-d1'
});

const membershipIn = (householdId: string, roleSlug: 'admin' | 'member' = 'admin'): Membership => ({
	membershipId: `membership_${householdId}`,
	householdId,
	workosUserId: 'user_alice',
	roleSlug,
	permissions: ['recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
	status: 'active',
	directoryManaged: false,
	workosCreatedAt: '2026-08-21T12:00:00.000Z',
	lastVerifiedAt: '2026-08-21T12:00:00.000Z',
	updatedAt: '2026-08-21T12:00:00.000Z',
	source: 'workos',
	detachedAt: null,
	denialCode: null
});

/** Signs Alice in on this device with an active membership in each household. */
const seedSignedInAlice = async (
	database: MaalDatabase,
	householdIds: readonly string[]
): Promise<string> => {
	const profileId = uuidv7();
	await database.profiles.put({
		profileId,
		workosUserId: 'user_alice',
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: '2026-08-21T12:00:00.000Z',
		authState: 'authenticated'
	});
	await database.authSlots.put({
		authSlotId: '0123456789abcdef0123456789abcdef',
		profileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: null,
		lastVerifiedAt: null,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.memberships.bulkPut(householdIds.map((householdId) => membershipIn(householdId)));
	return profileId;
};

describe('local billing projection', () => {
	it('defaults a free household to no remote request', async () => {
		database = await openMaalDatabase(`billing-free-${crypto.randomUUID()}`);
		await expect(shouldRefreshBillingOnLaunch(database, 'org_free')).resolves.toBe(false);
		await database.billingCapabilities.put({
			householdId: 'org_free',
			state: 'disabled',
			stripeStatus: null,
			subscriberUserId: null,
			stripePriceId: null,
			currentPeriodEnd: null,
			interruptionStartedAt: null,
			graceUntil: null,
			validUntil: null,
			cancelAtPeriodEnd: false,
			stale: true,
			source: 'stripe-d1'
		});
		await expect(shouldRefreshBillingOnLaunch(database, 'org_free')).resolves.toBe(false);
	});

	it('refreshes each paid or stale household once on launch, and never a lapsed or free one', async () => {
		database = await openMaalDatabase(`billing-launch-${crypto.randomUUID()}`);
		const profileId = uuidv7();
		await database.profiles.put({
			profileId,
			workosUserId: 'user_alice',
			displayName: 'Alice',
			email: 'alice@example.test',
			profilePictureUrl: null,
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: '2026-08-21T12:00:00.000Z',
			authState: 'authenticated'
		});
		await database.authSlots.put({
			authSlotId: '0123456789abcdef0123456789abcdef',
			profileId,
			workosUserId: 'user_alice',
			sessionState: 'authenticated',
			lastRefreshedAt: null,
			lastVerifiedAt: null,
			nextRetryAt: null,
			retryCount: 0
		});
		for (const householdId of ['org_kitchen', 'org_current', 'org_lapsed', 'org_free']) {
			await database.memberships.put({
				membershipId: `membership_${householdId}`,
				householdId,
				workosUserId: 'user_alice',
				roleSlug: 'admin',
				permissions: ['meals:read'],
				status: 'active',
				directoryManaged: false,
				workosCreatedAt: '2026-08-21T12:00:00.000Z',
				lastVerifiedAt: '2026-08-21T12:00:00.000Z',
				updatedAt: '2026-08-21T12:00:00.000Z',
				source: 'workos',
				detachedAt: null,
				denialCode: null
			});
		}
		await database.billingCapabilities.bulkPut([
			{ ...projection().capability, validUntil: '2026-08-21T11:59:59.000Z' },
			{ ...projection().capability, householdId: 'org_current' },
			{
				...projection().capability,
				householdId: 'org_lapsed',
				state: 'disabled',
				stripeStatus: 'canceled',
				validUntil: null
			},
			{
				householdId: 'org_free',
				state: 'disabled',
				stripeStatus: null,
				subscriberUserId: null,
				stripePriceId: null,
				currentPeriodEnd: null,
				interruptionStartedAt: null,
				graceUntil: null,
				validUntil: null,
				cancelAtPeriodEnd: false,
				stale: true,
				source: 'stripe-d1'
			}
		]);
		await database.remoteProjectionMeta.bulkPut([
			{
				key: 'billing:org_current',
				refreshedAt: '2026-08-01T12:00:00.000Z',
				decodeVersion: 1,
				value: {}
			},
			{
				key: 'billing:org_lapsed',
				refreshedAt: '2026-08-01T12:00:00.000Z',
				decodeVersion: 1,
				value: {}
			}
		]);
		const fetcher: typeof globalThis.fetch = vi.fn(async () => Response.json(projection()));

		await expect(refreshBillingProjectionsOnLaunch(database, fetcher)).resolves.toEqual({
			attempted: 2,
			refreshed: 2
		});
		expect(vi.mocked(fetcher).mock.calls.map(([input]) => String(input))).toEqual([
			expect.stringContaining('householdId=org_current'),
			expect.stringContaining('householdId=org_kitchen')
		]);
	});

	it('re-reads the active household after Checkout until the webhook plan lands', async () => {
		database = await openMaalDatabase(`billing-checkout-${crypto.randomUUID()}`);
		const profileId = await seedSignedInAlice(database, ['org_kitchen']);
		await database.uiState.bulkPut([
			{ key: 'activeProfileId', value: profileId },
			{ key: `activeHouseholdId:${profileId}`, value: 'org_kitchen' }
		]);
		await database.billingCapabilities.put(neverPaid('org_kitchen'));
		const responses = [{ ...projection(), capability: neverPaid('org_kitchen') }, projection()];
		const fetcher: typeof globalThis.fetch = vi.fn(async () => Response.json(responses.shift()));
		const wait = vi.fn(async () => {});

		await refreshBillingOnLoad(database, new URL('https://maal.test/household'), fetcher, wait);
		expect(fetcher).not.toHaveBeenCalled();

		await refreshBillingOnLoad(
			database,
			new URL('https://maal.test/household?billing=checkout-success'),
			fetcher,
			wait
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
		await expect(database.billingCapabilities.get('org_kitchen')).resolves.toMatchObject({
			state: 'enabled'
		});
	});

	it.each(['disabled', 'failed', 'enabled', 'portal', 'never-enabled'] as const)(
		'handles a stale paid Checkout return after a %s status read',
		async (initial) => {
			database = await openMaalDatabase(`billing-stale-checkout-${crypto.randomUUID()}`);
			const profileId = await seedSignedInAlice(database, ['org_kitchen']);
			await database.uiState.bulkPut([
				{ key: 'activeProfileId', value: profileId },
				{ key: `activeHouseholdId:${profileId}`, value: 'org_kitchen' }
			]);
			const disabled = {
				...projection().capability,
				state: 'disabled' as const,
				stripeStatus: 'canceled' as const,
				validUntil: null
			};
			await database.billingCapabilities.put({ ...disabled, stale: true });
			const fetcher = vi.fn<typeof fetch>(async (): Promise<Response> => {
				if (initial === 'failed' && fetcher.mock.calls.length === 1) {
					return new Response(null, { status: 503 });
				}
				return Response.json(
					initial === 'never-enabled' || (initial !== 'enabled' && fetcher.mock.calls.length === 1)
						? { ...projection(), capability: disabled }
						: projection()
				);
			});
			const wait = vi.fn(async () => {});

			await refreshBillingOnLoad(
				database,
				new URL(
					`https://maal.test/household?billing=${initial === 'portal' ? 'returned' : 'checkout-success'}`
				),
				fetcher,
				wait
			);

			const retries =
				initial === 'never-enabled' ? 5 : initial === 'enabled' || initial === 'portal' ? 0 : 1;
			expect(fetcher).toHaveBeenCalledTimes(1 + retries);
			expect(wait.mock.calls).toEqual(
				[1_000, 2_000, 4_000, 8_000, 16_000].slice(0, retries).map((pause) => [pause])
			);
			await expect(database.billingCapabilities.get('org_kitchen')).resolves.toMatchObject({
				state: initial === 'portal' || initial === 'never-enabled' ? 'disabled' : 'enabled'
			});
		}
	);

	it('stores the plan of a household joined by invite, so its sync starts', async () => {
		database = await openMaalDatabase(`billing-join-${crypto.randomUUID()}`);
		const profileId = await seedSignedInAlice(database, []);
		const fetcher: typeof globalThis.fetch = vi.fn(async (input) =>
			String(input).includes('/billing/status')
				? Response.json(projection())
				: Response.json({
						schemaVersion: 1,
						payload: {
							household: {
								schemaVersion: 1,
								revision: 1,
								createdAt: '2026-08-21T12:00:00.000Z',
								updatedAt: '2026-08-21T12:00:00.000Z',
								deletedAt: null,
								conflictClocks: {},
								householdId: 'org_kitchen',
								name: 'Kitchen',
								locale: 'en-NL',
								timezone: 'Europe/Amsterdam',
								weekStartsOn: 1,
								defaultPlannedYield: 4,
								preferredDinnerTime: '18:30',
								createdByUserId: 'user_bob',
								deletionState: 'active',
								localOnly: false
							},
							membership: membershipIn('org_kitchen', 'member')
						}
					})
		);

		await joinRemoteHousehold(database, profileId, 'ABCD-EFGH-IJKL', fetcher);

		await expect(
			resolveLocalHouseholdSyncCapability(
				database,
				'user_alice',
				'org_kitchen',
				new Date('2026-08-21T12:00:00.000Z')
			)
		).resolves.toMatchObject({ enabled: true });
	});

	it('keeps a renewing plan syncing past its cached period end, and stops a cancelling one', async () => {
		database = await openMaalDatabase(`billing-renewal-${crypto.randomUUID()}`);
		await seedSignedInAlice(database, ['org_kitchen']);
		await database.billingCapabilities.put(projection().capability);
		const afterPeriodEnd = new Date('2026-09-21T12:00:01.000Z');

		await expect(
			resolveLocalHouseholdSyncCapability(database, 'user_alice', 'org_kitchen', afterPeriodEnd)
		).resolves.toMatchObject({ enabled: true });
		await expect(
			resolveLocalUserSyncCapability(database, 'user_alice', afterPeriodEnd)
		).resolves.toMatchObject({ enabled: true });

		await database.billingCapabilities.update('org_kitchen', { cancelAtPeriodEnd: true });
		await expect(
			resolveLocalHouseholdSyncCapability(database, 'user_alice', 'org_kitchen', afterPeriodEnd)
		).resolves.toMatchObject({ enabled: false });
		await expect(
			resolveLocalUserSyncCapability(database, 'user_alice', afterPeriodEnd)
		).resolves.toMatchObject({ enabled: false });
	});

	it('commits capability and projection metadata in Dexie', async () => {
		database = await openMaalDatabase(`billing-projection-${crypto.randomUUID()}`);
		await applyBillingProjection(database, projection());
		await expect(database.billingCapabilities.get('org_kitchen')).resolves.toMatchObject({
			state: 'enabled',
			stripeStatus: 'active'
		});
		await expect(database.remoteProjectionMeta.get('billing:org_kitchen')).resolves.toMatchObject({
			decodeVersion: 1,
			value: { trialAvailable: false }
		});
	});

	it('contacts billing only for an explicit refresh and persists the response', async () => {
		database = await openMaalDatabase(`billing-refresh-${crypto.randomUUID()}`);
		const profileId = uuidv7();
		await database.profiles.put({
			profileId,
			workosUserId: 'user_alice',
			displayName: 'Alice',
			email: 'alice@example.test',
			profilePictureUrl: null,
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: '2026-08-21T12:00:00.000Z',
			authState: 'authenticated'
		});
		await database.authSlots.put({
			authSlotId: '0123456789abcdef0123456789abcdef',
			profileId,
			workosUserId: 'user_alice',
			sessionState: 'authenticated',
			lastRefreshedAt: null,
			lastVerifiedAt: null,
			nextRetryAt: null,
			retryCount: 0
		});
		const requests: string[] = [];
		const fetcher: typeof globalThis.fetch = vi.fn(async (input) => {
			requests.push(String(input));
			return Response.json(projection(), { headers: { 'content-type': 'application/json' } });
		});
		await refreshBillingProjection(database, profileId, 'org_kitchen', fetcher);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(requests[0]).toContain('householdId=org_kitchen');
		await expect(database.billingCapabilities.get('org_kitchen')).resolves.toMatchObject({
			state: 'enabled'
		});
	});

	it('keeps a pending Stripe refund out of the local recovery window', async () => {
		database = await openMaalDatabase(`billing-deletion-${crypto.randomUUID()}`);
		const profileId = uuidv7();
		await database.profiles.put({
			profileId,
			workosUserId: 'user_alice',
			displayName: 'Alice',
			email: 'alice@example.test',
			profilePictureUrl: null,
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: '2026-08-21T12:00:00.000Z',
			authState: 'authenticated'
		});
		await database.authSlots.put({
			authSlotId: '0123456789abcdef0123456789abcdef',
			profileId,
			workosUserId: 'user_alice',
			sessionState: 'authenticated',
			lastRefreshedAt: null,
			lastVerifiedAt: null,
			nextRetryAt: null,
			retryCount: 0
		});
		await database.households.put({
			householdId: 'org_kitchen',
			name: 'Kitchen',
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			weekStartsOn: 1,
			defaultPlannedYield: 4,
			preferredDinnerTime: '18:30',
			createdByUserId: 'user_alice',
			deletionState: 'active',
			localOnly: false,
			schemaVersion: 1,
			revision: 1,
			createdAt: '2026-08-21T12:00:00.000Z',
			updatedAt: '2026-08-21T12:00:00.000Z',
			deletedAt: null,
			conflictClocks: {}
		});
		await database.billingCapabilities.put(projection().capability);
		const fetcher: typeof globalThis.fetch = vi.fn(async () =>
			Response.json({ state: 'refunding' })
		);

		await expect(
			requestHouseholdDeletion(database, profileId, 'org_kitchen', fetcher)
		).resolves.toBe('pending');
		await expect(database.households.get('org_kitchen')).resolves.toMatchObject({
			deletionState: 'deletionPending'
		});
		await expect(database.billingCapabilities.get('org_kitchen')).resolves.toMatchObject({
			state: 'disabled',
			validUntil: null
		});
	});
});
