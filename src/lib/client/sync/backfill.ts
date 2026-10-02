import type { MaalDatabase } from '$lib/client/local/database.js';
import type { ScopeKind } from '$lib/domain/contracts/primitives.js';

import { scopeOutbox } from './outbox.js';

/** One backfill batch per device in this window, across the user scope and every household. */
export const DEVICE_BACKFILL_INTERVAL_MS = 30_000;

const BUDGET_KEY = 'backfillBudget';

/**
 * Claims the device's backfill slot. Every scope's coordinator shares it, so a device sends at most
 * one batch (25 aggregates, 256 KiB) per interval however many households it syncs. The claim lives in
 * Dexie, so tabs share it too. Returns false while another batch holds the slot.
 */
export const claimBackfillSlot = (database: MaalDatabase, now: Date): Promise<boolean> =>
	database.transaction('rw', database.meta, async () => {
		const claimed = await database.meta.get(BUDGET_KEY);
		const last = typeof claimed?.value === 'string' ? Date.parse(claimed.value) : Number.NaN;
		if (now.getTime() - last < DEVICE_BACKFILL_INTERVAL_MS) return false;
		const at = now.toISOString() as `${string}Z`;
		await database.meta.put({ key: BUDGET_KEY, value: at, updatedAt: at });
		return true;
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
 * a push is still carrying them, or an earlier attempt was refused. Only never-acknowledged records
 * with no outcome yet stay eligible.
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
				'rejected'
			])
		).map(({ entityKind, aggregateId }) => `${entityKind}\u0000${aggregateId}`)
	);
