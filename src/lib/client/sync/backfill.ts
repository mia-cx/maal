import type { MaalDatabase } from '$lib/client/local/database.js';
import type { ScopeKind } from '$lib/domain/contracts/primitives.js';

import { scopeOutbox } from './outbox.js';

/** One backfill batch per device in this window, across the user scope and every household. */
export const DEVICE_BACKFILL_INTERVAL_MS = 30_000;

const BUDGET_KEY = 'backfillBudget';
const WAITERS_KEY = 'backfillWaiters';

interface BackfillWaiter {
	scope: string;
	lastSeenAt: number;
}

/**
 * Claims the device's backfill slot. Every scope's coordinator shares it, so a device sends at most
 * one batch (25 aggregates, 256 KiB) per interval however many households it syncs. The claim lives in
 * Dexie, so tabs share it too. Waiting scopes take turns; inactive waiters expire after two retries.
 */
export const claimBackfillSlot = (
	database: MaalDatabase,
	scopeKind: ScopeKind,
	scopeId: string,
	now: Date
): Promise<boolean> =>
	database.transaction('rw', database.meta, async () => {
		const scope = `${scopeKind}\u0000${scopeId}`;
		const timestamp = now.getTime();
		const stored = await database.meta.get(WAITERS_KEY);
		const waiters = ((stored?.value ?? []) as BackfillWaiter[]).filter(
			(waiter) => timestamp - waiter.lastSeenAt < 2 * DEVICE_BACKFILL_INTERVAL_MS
		);
		const waiter = waiters.find((waiter) => waiter.scope === scope);
		if (waiter) waiter.lastSeenAt = timestamp;
		else waiters.push({ scope, lastSeenAt: timestamp });
		const claimed = await database.meta.get(BUDGET_KEY);
		const last = typeof claimed?.value === 'string' ? Date.parse(claimed.value) : Number.NaN;
		const at = now.toISOString() as `${string}Z`;
		const available =
			!(timestamp - last < DEVICE_BACKFILL_INTERVAL_MS) && waiters[0].scope === scope;
		if (available) {
			waiters.shift();
			await database.meta.put({ key: BUDGET_KEY, value: at, updatedAt: at });
		}
		await database.meta.put({ key: WAITERS_KEY, value: waiters, updatedAt: at });
		return available;
	});

/**
 * Sort key for a meal's place in backfill: upcoming meals soonest first, then past meals most recent
 * first, then undated ones. Recipes referenced by a meal borrow its key.
 */
export const mealPriorityKey = (date: unknown, id: string, now: Date): string => {
	if (typeof date !== 'string') return `4:${id}`;
	const today = now.toISOString().slice(0, 10);
	if (date >= today) return `0:${date}:${id}`;
	const inverse = String(9_999_999_999_999 - Date.parse(`${date}T00:00:00.000Z`)).padStart(13, '0');
	return `1:${inverse}:${id}`;
};

/**
 * Aggregates backfill must skip: the server already has them (an acknowledged row, pushed or received),
 * a push is still carrying them, or an earlier attempt was refused or quarantined — a quarantined edit
 * belongs to a revoked member and must never ride another member's credentials. Only
 * never-acknowledged records with no outcome yet stay eligible.
 */
export const backfillIneligibleKeys = async (
	database: MaalDatabase,
	scopeKind: ScopeKind,
	scopeId: string
): Promise<Set<string>> =>
	new Set(
		(
			await scopeOutbox(database, scopeKind, scopeId, [
				'acknowledged',
				'pending',
				'sending',
				'quarantined',
				'rejected'
			])
		).map(({ entityKind, aggregateId }) => `${entityKind}\u0000${aggregateId}`)
	);
