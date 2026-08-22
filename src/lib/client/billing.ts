import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import {
	billingCapabilityIsEnabledAt,
	billingCapabilityWasPreviouslyPaid
} from '$lib/domain/billing/capability.js';
import {
	BillingProjectionEnvelopeSchema,
	type BillingProjectionEnvelope
} from '$lib/domain/billing/contracts.js';

type Fetch = typeof globalThis.fetch;

const slotForProfile = async (database: MaalDatabase, profileId: string): Promise<string> => {
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	if (!slot || slot.sessionState === 'revoked') throw new LocalBillingAuthRequired();
	return slot.authSlotId;
};

const route = (slotId: string, action: string): string =>
	`/api/auth-slots/${encodeURIComponent(slotId)}/billing/${action}`;

const errorTag = async (response: Response): Promise<string> => {
	const body = await response.json().catch(() => null);
	return typeof body === 'object' && body !== null && 'error' in body
		? JSON.stringify(body.error)
		: `HTTP ${response.status}`;
};

const post = async <T>(
	database: MaalDatabase,
	profileId: string,
	action: string,
	body: Readonly<Record<string, unknown>>,
	method: 'POST' | 'PATCH' = 'POST',
	fetcher: Fetch = globalThis.fetch
): Promise<T> => {
	const slotId = await slotForProfile(database, profileId);
	const response = await fetcher(route(slotId, action), {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!response.ok) throw new LocalBillingRequestFailed(await errorTag(response));
	return (await response.json()) as T;
};

export const applyBillingProjection = async (
	database: MaalDatabase,
	envelope: BillingProjectionEnvelope
): Promise<void> => {
	const decoded = Schema.decodeUnknownSync(BillingProjectionEnvelopeSchema)(envelope);
	await database.transaction(
		'rw',
		[database.billingCapabilities, database.remoteProjectionMeta],
		async () => {
			await database.billingCapabilities.put(decoded.capability);
			await database.remoteProjectionMeta.put({
				key: `billing:${decoded.capability.householdId}`,
				refreshedAt: decoded.refreshedAt,
				decodeVersion: decoded.schemaVersion,
				value: {
					prices: decoded.prices,
					trialAvailable: decoded.trialAvailable,
					trialUnavailableReason: decoded.trialUnavailableReason
				}
			});
		}
	);
};

export const refreshBillingProjection = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<BillingProjectionEnvelope> => {
	const slotId = await slotForProfile(database, profileId);
	const response = await fetcher(
		`${route(slotId, 'status')}?householdId=${encodeURIComponent(householdId)}`
	);
	if (!response.ok) throw new LocalBillingRequestFailed(await errorTag(response));
	const decoded = Schema.decodeUnknownSync(BillingProjectionEnvelopeSchema)(await response.json());
	await applyBillingProjection(database, decoded);
	return decoded;
};

export const shouldRefreshBillingOnLaunch = async (
	database: MaalDatabase,
	householdId: string,
	now = Date.now()
): Promise<boolean> => {
	const capability = await database.billingCapabilities.get(householdId);
	if (!capability) return false;
	if (!billingCapabilityWasPreviouslyPaid(capability)) return false;
	if (capability.stale) return true;
	return capability.state !== 'disabled' && !billingCapabilityIsEnabledAt(capability, now);
};

export const refreshBillingProjectionsOnLaunch = async (
	database: MaalDatabase,
	fetcher: Fetch = globalThis.fetch,
	now = Date.now()
): Promise<{ attempted: number; refreshed: number }> => {
	const [capabilities, memberships, slots] = await Promise.all([
		database.billingCapabilities.toArray(),
		database.memberships
			.toArray()
			.then((records) => records.filter(({ status }) => status === 'active')),
		database.authSlots.where('sessionState').equals('authenticated').toArray()
	]);
	const profileByUserId = new Map(slots.map((slot) => [slot.workosUserId, slot.profileId]));
	const profileByHouseholdId = new Map<string, string>();
	for (const membership of memberships) {
		const profileId = profileByUserId.get(membership.workosUserId);
		if (profileId && !profileByHouseholdId.has(membership.householdId)) {
			profileByHouseholdId.set(membership.householdId, profileId);
		}
	}
	let attempted = 0;
	let refreshed = 0;
	for (const capability of capabilities) {
		const profileId = profileByHouseholdId.get(capability.householdId);
		if (
			!profileId ||
			!(await shouldRefreshBillingOnLaunch(database, capability.householdId, now))
		) {
			continue;
		}
		attempted += 1;
		try {
			await refreshBillingProjection(database, profileId, capability.householdId, fetcher);
			refreshed += 1;
		} catch {
			// The cached expiry still blocks content sync. A later launch or explicit billing action retries.
		}
	}
	return { attempted, refreshed };
};

export const beginCheckout = (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	priceId: string,
	fetcher?: Fetch
): Promise<{ url: string }> =>
	post(
		database,
		profileId,
		'checkout',
		{ householdId, priceId, idempotencyKey: crypto.randomUUID() },
		'POST',
		fetcher
	);

export const beginTrial = (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	priceId: string | undefined,
	fetcher?: Fetch
): Promise<{ started: true }> =>
	post(
		database,
		profileId,
		'trial',
		{ householdId, ...(priceId ? { priceId } : {}) },
		'POST',
		fetcher
	);

export const openBillingPortal = (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	fetcher?: Fetch
): Promise<{ url: string }> =>
	post(database, profileId, 'portal', { householdId }, 'POST', fetcher);

export const transferBillingOwner = (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	newSubscriberUserId: string,
	fetcher?: Fetch
): Promise<{ transferred: true }> =>
	post(database, profileId, 'transfer', { householdId, newSubscriberUserId }, 'POST', fetcher);

export const requestHouseholdDeletion = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	fetcher?: Fetch
): Promise<'recoverable' | 'pending'> => {
	const deletion = await post<{ state: string }>(
		database,
		profileId,
		'household-deletion',
		{ householdId },
		'POST',
		fetcher
	);
	const state = deletion.state === 'recoverable' ? 'recoverable' : 'pending';
	await database.transaction(
		'rw',
		[database.households, database.billingCapabilities],
		async () => {
			await database.households.update(householdId, {
				deletionState: state === 'recoverable' ? 'recoverable' : 'deletionPending'
			});
			const capability = await database.billingCapabilities.get(householdId);
			if (capability) {
				await database.billingCapabilities.put({
					...capability,
					state: 'disabled',
					validUntil: null,
					stale: false
				});
			}
		}
	);
	return state;
};

export const recoverHousehold = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	fetcher?: Fetch
): Promise<void> => {
	await post(database, profileId, 'household-deletion', { householdId }, 'PATCH', fetcher);
	await database.households.update(householdId, { deletionState: 'active' });
};

export class LocalBillingAuthRequired extends Error {
	readonly _tag = 'LocalBillingAuthRequired';
	constructor() {
		super('Reauthenticate this profile to manage billing.');
	}
}

export class LocalBillingRequestFailed extends Error {
	readonly _tag = 'LocalBillingRequestFailed';
	constructor(readonly safeMessage: string) {
		super('The billing request failed.');
	}
}
