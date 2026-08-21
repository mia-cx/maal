import type { ScopeKind } from '$lib/domain/contracts/primitives.js';

import type { MaalDatabase } from './database.js';
import type { SyncScopeRecord } from './records.js';

export interface SyncLease {
	scopeKind: ScopeKind;
	scopeId: string;
	owner: string;
	expiresAt: string;
}

const expiresAt = (now: Date, ttlMilliseconds: number): `${string}Z` => {
	if (!Number.isFinite(ttlMilliseconds) || ttlMilliseconds <= 0) {
		throw new RangeError('A sync lease TTL must be positive.');
	}
	return new Date(now.getTime() + ttlMilliseconds).toISOString() as `${string}Z`;
};

export const acquireSyncLease = async (
	database: MaalDatabase,
	input: Omit<SyncLease, 'expiresAt'> & { ttlMilliseconds: number; now?: Date }
): Promise<SyncLease | null> =>
	database.transaction('rw', database.syncScopes, async () => {
		const now = input.now ?? new Date();
		const key: [string, string] = [input.scopeKind, input.scopeId];
		const current = await database.syncScopes.get(key);
		if (
			current?.leaseOwner &&
			current.leaseOwner !== input.owner &&
			current.leaseExpiresAt &&
			Date.parse(current.leaseExpiresAt) > now.getTime()
		) {
			return null;
		}

		const lease: SyncLease = {
			scopeKind: input.scopeKind,
			scopeId: input.scopeId,
			owner: input.owner,
			expiresAt: expiresAt(now, input.ttlMilliseconds)
		};
		const next: SyncScopeRecord = {
			scopeKind: input.scopeKind,
			scopeId: input.scopeId,
			cursor: current?.cursor ?? null,
			bootstrapGeneration: current?.bootstrapGeneration ?? null,
			retainedFloor: current?.retainedFloor ?? null,
			state: current?.state ?? 'idle',
			leaseOwner: lease.owner,
			leaseExpiresAt: lease.expiresAt as `${string}Z`,
			lastSuccessAt: current?.lastSuccessAt ?? null,
			lastErrorCode: current?.lastErrorCode ?? null
		};
		await database.syncScopes.put(next);
		return lease;
	});

export const releaseSyncLease = async (
	database: MaalDatabase,
	lease: Pick<SyncLease, 'scopeKind' | 'scopeId' | 'owner'>
): Promise<boolean> =>
	database.transaction('rw', database.syncScopes, async () => {
		const key: [string, string] = [lease.scopeKind, lease.scopeId];
		const current = await database.syncScopes.get(key);
		if (!current || current.leaseOwner !== lease.owner) return false;
		await database.syncScopes.update(key, { leaseOwner: null, leaseExpiresAt: null });
		return true;
	});
