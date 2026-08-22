import type { MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxRecord, SyncScopeRecord } from '$lib/client/local/records.js';
import { decodeUserSyncAggregate, USER_SYNC_ENTITY_DESCRIPTORS } from '$lib/sync/user-entities.js';
import type {
	BootstrapResponse,
	MutationReceipt,
	PullResponse,
	SnapshotManifestEntry,
	SyncChange,
	UserSyncEntityKind
} from '$lib/sync/contracts.js';

const keyFor = (entityKind: string, entityId: string): string => `${entityKind}\u0000${entityId}`;

const pendingUserOutbox = async (
	database: MaalDatabase,
	workosUserId: string
): Promise<OutboxRecord[]> => {
	const records = await database.outbox.toArray();
	return records.filter(
		(record) =>
			record.scopeKind === 'user' &&
			record.scopeId === workosUserId &&
			(record.status === 'pending' || record.status === 'sending')
	);
};

const decodedChanges = (
	workosUserId: string,
	changes: readonly SyncChange[],
	requireSequenceOrder: boolean
): ReturnType<typeof decodeUserSyncAggregate>[] => {
	let prior = -1;
	return changes.map((change) => {
		if (requireSequenceOrder && change.sequence <= prior) {
			throw new TypeError('Sync changes must be strictly ordered.');
		}
		prior = change.sequence;
		return decodeUserSyncAggregate(
			change.entityKind,
			change.entityId,
			workosUserId,
			change.aggregate
		);
	});
};

export const applyUserPullPage = async (
	database: MaalDatabase,
	workosUserId: string,
	response: PullResponse,
	now = new Date()
): Promise<void> => {
	const decoded = decodedChanges(workosUserId, response.changes, true);
	if (response.changes.some(({ sequence }) => sequence > response.throughSequence)) {
		throw new TypeError('A sync page cannot advance behind one of its changes.');
	}
	const tables = [...new Set(decoded.map(({ store }) => database.table(store)))];
	await database.transaction('rw', [...tables, database.outbox, database.syncScopes], async () => {
		const pending = await pendingUserOutbox(database, workosUserId);
		const pendingKeys = new Set(pending.map((row) => keyFor(row.entityKind, row.aggregateId)));
		const pendingByKey = Map.groupBy(pending, (row) => keyFor(row.entityKind, row.aggregateId));
		const localIntent = new Map<string, unknown>();
		for (const aggregate of decoded) {
			const key = keyFor(aggregate.entityKind, aggregate.entityId);
			if (pendingKeys.has(key)) {
				if (!localIntent.has(key)) {
					localIntent.set(key, await database.table(aggregate.store).get(aggregate.entityId));
				}
				for (const row of pendingByKey.get(key) ?? []) {
					await database.outbox.update(row.mutationId, {
						authoritativeSnapshot: aggregate.aggregate
					});
				}
			}
			await database.table(aggregate.store).put(aggregate.aggregate);
		}
		for (const aggregate of decoded) {
			const local = localIntent.get(keyFor(aggregate.entityKind, aggregate.entityId));
			if (local !== undefined) await database.table(aggregate.store).put(local);
		}
		const current = await database.syncScopes.get(['user', workosUserId]);
		if (
			current?.cursor !== null &&
			current?.cursor !== undefined &&
			response.throughSequence < current.cursor
		) {
			throw new TypeError('A stale sync page cannot move the local cursor backwards.');
		}
		const next: SyncScopeRecord = {
			scopeKind: 'user',
			scopeId: workosUserId,
			cursor: response.throughSequence,
			bootstrapGeneration: response.bootstrapGeneration,
			retainedFloor: response.retainedFloor,
			state: 'syncing',
			leaseOwner: current?.leaseOwner ?? null,
			leaseExpiresAt: current?.leaseExpiresAt ?? null,
			lastSuccessAt: now.toISOString() as `${string}Z`,
			lastErrorCode: null
		};
		await database.syncScopes.put(next);
	});
};

export const applyUserMutationReceipts = async (
	database: MaalDatabase,
	workosUserId: string,
	receipts: readonly MutationReceipt[],
	now = new Date()
): Promise<void> => {
	const resolved = await Promise.all(
		receipts.map(async (receipt) => {
			const row = await database.outbox.get(receipt.mutationId);
			const authoritative =
				row && receipt.status === 'rejected' && row.authoritativeSnapshot !== undefined
					? decodeUserSyncAggregate(
							row.entityKind as UserSyncEntityKind,
							row.aggregateId,
							workosUserId,
							row.authoritativeSnapshot
						)
					: null;
			return { receipt, row, authoritative };
		})
	);
	const tables = resolved.flatMap(({ authoritative }) =>
		authoritative ? [database.table(authoritative.store)] : []
	);
	await database.transaction('rw', [...new Set(tables), database.outbox], async () => {
		for (const { receipt, row, authoritative } of resolved) {
			if (!row) continue;
			if (receipt.status === 'accepted' || receipt.status === 'duplicate') {
				await database.outbox.update(receipt.mutationId, {
					status: 'acknowledged',
					acknowledgedSequence: receipt.sequence,
					acknowledgedAt: now.toISOString()
				});
				continue;
			}
			if (!('errorCode' in receipt)) continue;
			await database.outbox.update(receipt.mutationId, {
				status: 'rejected',
				rejectionCode: receipt.errorCode,
				acknowledgedAt: now.toISOString()
			});
			if (authoritative) {
				await database.table(authoritative.store).put(authoritative.aggregate);
			}
		}
	});
};

export const applyUserBootstrap = async (
	database: MaalDatabase,
	workosUserId: string,
	response: BootstrapResponse,
	now = new Date()
): Promise<void> => {
	// Bootstrap pages use a stable entity-key order for pagination, not commit order.
	const decoded = decodedChanges(workosUserId, response.aggregates, false);
	const tables = [...new Set(decoded.map(({ store }) => database.table(store)))];
	for (const instruction of response.instructions) {
		tables.push(database.table(USER_SYNC_ENTITY_DESCRIPTORS[instruction.entityKind].store));
	}
	await database.transaction(
		'rw',
		[...new Set(tables), database.outbox, database.syncScopes],
		async () => {
			const pending = await pendingUserOutbox(database, workosUserId);
			const pendingKeys = new Set(pending.map((row) => keyFor(row.entityKind, row.aggregateId)));
			for (const aggregate of decoded) {
				if (!pendingKeys.has(keyFor(aggregate.entityKind, aggregate.entityId))) {
					await database.table(aggregate.store).put(aggregate.aggregate);
				}
			}
			for (const instruction of response.instructions) {
				if (
					instruction.action === 'delete_acknowledged_absence' &&
					!pendingKeys.has(keyFor(instruction.entityKind, instruction.entityId))
				) {
					await database
						.table(USER_SYNC_ENTITY_DESCRIPTORS[instruction.entityKind].store)
						.delete(instruction.entityId);
				}
			}
			const current = await database.syncScopes.get(['user', workosUserId]);
			await database.syncScopes.put({
				scopeKind: 'user',
				scopeId: workosUserId,
				cursor: response.hasMore ? (current?.cursor ?? null) : response.throughSequence,
				bootstrapGeneration: response.bootstrapGeneration,
				retainedFloor: response.retainedFloor,
				state: response.hasMore ? 'bootstrapRequired' : 'syncing',
				leaseOwner: current?.leaseOwner ?? null,
				leaseExpiresAt: current?.leaseExpiresAt ?? null,
				lastSuccessAt: now.toISOString() as `${string}Z`,
				lastErrorCode: null
			});
		}
	);
};

export const buildUserSnapshotManifest = async (
	database: MaalDatabase,
	workosUserId: string
): Promise<SnapshotManifestEntry[]> => {
	const acknowledged = new Set(
		(await database.outbox.toArray())
			.filter((row) => row.scopeKind === 'user' && row.status === 'acknowledged')
			.map((row) => keyFor(row.entityKind, row.aggregateId))
	);
	const manifest: SnapshotManifestEntry[] = [];
	for (const [entityKind, descriptor] of Object.entries(USER_SYNC_ENTITY_DESCRIPTORS) as [
		UserSyncEntityKind,
		(typeof USER_SYNC_ENTITY_DESCRIPTORS)[UserSyncEntityKind]
	][]) {
		const records = (await database.table(descriptor.store).toArray()) as Record<string, unknown>[];
		for (const record of records) {
			const owner = record.ownerUserId ?? record.workosUserId;
			if (owner !== workosUserId) continue;
			const decoded = decodeUserSyncAggregate(entityKind, String(record.id), workosUserId, record);
			manifest.push({
				entityKind,
				entityId: decoded.entityId,
				revision: decoded.aggregate.revision,
				updatedAt: decoded.aggregate.updatedAt as `${string}Z`,
				previousServerAck: acknowledged.has(keyFor(entityKind, decoded.entityId))
			});
		}
	}
	return manifest;
};
