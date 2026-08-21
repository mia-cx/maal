import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';

import {
	applyBillingProjection,
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
