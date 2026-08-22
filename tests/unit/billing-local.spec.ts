import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';

import {
	applyBillingProjection,
	refreshBillingProjectionsOnLaunch,
	refreshBillingProjection,
	shouldRefreshBillingOnLaunch
} from '$lib/client/billing.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/index.js';
import type { BillingProjectionEnvelope } from '$lib/domain/billing/contracts.js';

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

	it('refreshes only stale or expired previously-paid projections on launch', async () => {
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

		await expect(
			refreshBillingProjectionsOnLaunch(database, fetcher, Date.parse('2026-08-21T12:00:00.000Z'))
		).resolves.toEqual({ attempted: 1, refreshed: 1 });
		expect(fetcher).toHaveBeenCalledOnce();
		expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toContain('householdId=org_kitchen');
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
});
