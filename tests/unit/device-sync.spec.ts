import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { refreshBillingProjection } from '$lib/client/billing.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { startDeviceSync, type DeviceSyncManager } from '$lib/client/sync/device-coordinator.js';
import type { HouseholdSyncTransport } from '$lib/client/sync/household-transport.js';
import type { UserSyncTransport } from '$lib/client/sync/transport.js';
import type { BillingProjectionEnvelope } from '$lib/domain/billing/contracts.js';
import { SyncCapabilityDenied, SyncPermissionDenied } from '$lib/sync/contracts.js';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const householdId = 'household_paid';
const userId = 'user_alice';
const authSlotId = 'a'.repeat(32);
let database: MaalDatabase;
let manager: DeviceSyncManager | undefined;

beforeEach(async () => {
	// Leave Dexie and coordinator timers real.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(timestamp));
	vi.stubGlobal('navigator', { onLine: true, connection: { saveData: true } });
	database = await openMaalDatabase(`device-sync-${crypto.randomUUID()}`);
	await database.authSlots.put({
		authSlotId,
		profileId: 'profile_alice',
		workosUserId: userId,
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.memberships.put({
		membershipId: 'membership_alice',
		householdId,
		workosUserId: userId,
		roleSlug: 'admin',
		permissions: ['recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: timestamp,
		lastVerifiedAt: timestamp,
		updatedAt: timestamp,
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
	await database.billingCapabilities.put(projection().capability);
});

afterEach(async () => {
	manager?.stop();
	manager = undefined;
	// Finish any in-flight run before closing IndexedDB.
	await new Promise((resolve) => setTimeout(resolve, 50));
	database.close();
	await Dexie.delete(database.name);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const projection = (): BillingProjectionEnvelope => ({
	schemaVersion: 1,
	refreshedAt: timestamp,
	capability: {
		householdId,
		state: 'enabled',
		stripeStatus: 'active',
		subscriberUserId: userId,
		stripePriceId: 'price_test',
		currentPeriodEnd: timestamp,
		interruptionStartedAt: null,
		graceUntil: null,
		validUntil: timestamp,
		cancelAtPeriodEnd: false,
		stale: false,
		source: 'stripe-d1'
	},
	prices: [],
	trialAvailable: false,
	trialUnavailableReason: 'user_already_claimed'
});

const emptyPull = (after: number) => ({
	protocolVersion: 1 as const,
	changes: [],
	throughSequence: after,
	retainedFloor: 0,
	bootstrapGeneration: 1,
	hasMore: false
});

const userTransport = (): UserSyncTransport => ({
	pull: vi.fn(async (_slot, request) => emptyPull(request.after)),
	push: vi.fn(async () => ({ protocolVersion: 1 as const, receipts: [], committedThrough: 0 })),
	bootstrap: vi.fn(),
	backfill: vi.fn()
});

const householdTransport = (): HouseholdSyncTransport => ({
	pull: vi.fn(async (_slot, request) => emptyPull(request.after)),
	push: vi.fn(),
	bootstrap: vi.fn(),
	backfill: vi.fn()
});

const waitForBlocked = async (): Promise<void> => {
	await vi.waitFor(async () => {
		expect(await database.syncScopes.get(['user', userId])).toMatchObject({ state: 'blocked' });
	});
};

test('a successful renewal refresh resumes blocked user sync in the existing device manager', async () => {
	const user = userTransport();
	const household = householdTransport();
	vi.mocked(user.pull).mockRejectedValueOnce(
		new SyncCapabilityDenied({ code: 'maal_plan_required', message: 'Awaiting renewal webhook.' })
	);
	vi.mocked(household.pull).mockRejectedValueOnce(
		new SyncCapabilityDenied({ code: 'maal_plan_required', message: 'Awaiting renewal webhook.' })
	);
	manager = startDeviceSync(database, user, household);
	await waitForBlocked();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(user.pull).toHaveBeenCalledTimes(1);

	const renewed: BillingProjectionEnvelope = {
		...projection(),
		capability: {
			...projection().capability,
			currentPeriodEnd: '2026-09-21T12:00:00.000Z',
			validUntil: '2026-09-21T12:00:00.000Z'
		}
	};
	await refreshBillingProjection(database, 'profile_alice', householdId, async () =>
		Response.json(renewed)
	);
	await vi.waitFor(async () => {
		expect(await database.syncScopes.get(['user', userId])).toMatchObject({
			state: 'idle',
			lastSuccessAt: expect.any(String),
			lastErrorCode: null
		});
	});
	expect(user.pull).toHaveBeenCalledTimes(2);
	expect(user.pull).toHaveBeenLastCalledWith(authSlotId, expect.any(Object));
	await vi.waitFor(async () => {
		expect(await database.syncScopes.get(['household', householdId])).toMatchObject({
			state: 'idle'
		});
	});
	expect(household.pull).toHaveBeenCalledTimes(2);
});

test('a repeated entitlement denial does not automatically retry its own stale-cache writes', async () => {
	const user = userTransport();
	vi.mocked(user.pull).mockRejectedValue(
		new SyncCapabilityDenied({ code: 'maal_plan_required', message: 'Denied.' })
	);
	manager = startDeviceSync(database, user, householdTransport());
	await waitForBlocked();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(user.pull).toHaveBeenCalledTimes(1);

	// Even an unchanged authoritative projection permits one new attempt, not a request loop.
	await refreshBillingProjection(database, 'profile_alice', householdId, async () =>
		Response.json(projection())
	);
	await vi.waitFor(() => expect(user.pull).toHaveBeenCalledTimes(2));
	await waitForBlocked();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(user.pull).toHaveBeenCalledTimes(2);
	expect(await database.billingCapabilities.get(householdId)).toMatchObject({ stale: true });
});

test('billing refresh does not clear a terminal user permission denial', async () => {
	const user = userTransport();
	vi.mocked(user.pull).mockRejectedValue(
		new SyncPermissionDenied({ code: 'recipes_permission_required', message: 'Denied.' })
	);
	manager = startDeviceSync(database, user, householdTransport());
	await waitForBlocked();
	await refreshBillingProjection(database, 'profile_alice', householdId, async () =>
		Response.json(projection())
	);
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(user.pull).toHaveBeenCalledTimes(1);
});

test('failed and disabled billing refreshes leave denied user sync paused', async () => {
	const user = userTransport();
	vi.mocked(user.pull).mockRejectedValue(
		new SyncCapabilityDenied({ code: 'maal_plan_required', message: 'Denied.' })
	);
	manager = startDeviceSync(database, user, householdTransport());
	await waitForBlocked();
	await expect(
		refreshBillingProjection(database, 'profile_alice', householdId, async () =>
			Response.json({ error: 'unavailable' }, { status: 503 })
		)
	).rejects.toMatchObject({ _tag: 'LocalBillingRequestFailed' });
	const disabled: BillingProjectionEnvelope = {
		...projection(),
		capability: { ...projection().capability, state: 'disabled', validUntil: null }
	};
	await refreshBillingProjection(database, 'profile_alice', householdId, async () =>
		Response.json(disabled)
	);
	await database.memberships.update('membership_alice', { lastVerifiedAt: timestamp });
	await manager.reconcileAuthSlots();
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(user.pull).toHaveBeenCalledTimes(1);
});

test('an aborted fresh-capability write cannot resume denied user sync', async () => {
	const user = userTransport();
	vi.mocked(user.pull).mockRejectedValue(
		new SyncCapabilityDenied({ code: 'maal_plan_required', message: 'Denied.' })
	);
	manager = startDeviceSync(database, user, householdTransport());
	await waitForBlocked();
	await expect(
		database.transaction('rw', database.billingCapabilities, async () => {
			await database.billingCapabilities.put(projection().capability);
			throw new Error('Abort refresh');
		})
	).rejects.toThrow('Abort refresh');
	await new Promise((resolve) => setTimeout(resolve, 100));
	expect(user.pull).toHaveBeenCalledTimes(1);
	expect(await database.billingCapabilities.get(householdId)).toMatchObject({ stale: true });
});
