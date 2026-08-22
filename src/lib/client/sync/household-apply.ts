import type { MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxRecord, SyncScopeRecord } from '$lib/client/local/records.js';
import type { MutationReceipt } from '$lib/sync/contracts.js';
import type {
	HouseholdBootstrapResponse,
	HouseholdPullResponse,
	HouseholdSnapshotManifestEntry,
	HouseholdSyncChange,
	HouseholdSyncEntityKind
} from '$lib/sync/household-contracts.js';
import {
	decodeHouseholdSyncAggregate,
	HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS
} from '$lib/sync/household-entities.js';

const keyFor = (entityKind: string, entityId: string): string => `${entityKind}\u0000${entityId}`;

const pendingHouseholdOutbox = async (
	database: MaalDatabase,
	householdId: string
): Promise<OutboxRecord[]> =>
	(await database.outbox.toArray()).filter(
		(record) =>
			record.scopeKind === 'household' &&
			record.scopeId === householdId &&
			(record.status === 'pending' ||
				record.status === 'sending' ||
				record.status === 'quarantined')
	);

const decodeChanges = (
	householdId: string,
	changes: readonly HouseholdSyncChange[],
	requireSequenceOrder: boolean
) => {
	let prior = -1;
	return changes.map((change) => {
		if (requireSequenceOrder && change.sequence <= prior) {
			throw new TypeError('Sync changes must be strictly ordered.');
		}
		prior = change.sequence;
		return decodeHouseholdSyncAggregate(
			change.entityKind,
			change.entityId,
			householdId,
			change.aggregate
		);
	});
};

const detachMealCheckIns = async (database: MaalDatabase, mealId: string): Promise<void> => {
	const checkIns = await database.mealCheckIns.where('mealId').equals(mealId).toArray();
	for (const checkIn of checkIns) await database.mealCheckIns.update(checkIn.id, { mealId: null });
};

export const applyHouseholdPullPage = async (
	database: MaalDatabase,
	householdId: string,
	response: HouseholdPullResponse,
	now = new Date()
): Promise<void> => {
	const decoded = decodeChanges(householdId, response.changes, true);
	if (response.changes.some(({ sequence }) => sequence > response.throughSequence)) {
		throw new TypeError('A sync page cannot advance behind one of its changes.');
	}
	const tables = [...new Set(decoded.map(({ store }) => database.table(store)))];
	await database.transaction(
		'rw',
		[...tables, database.mealCheckIns, database.outbox, database.syncScopes],
		async () => {
			const pending = await pendingHouseholdOutbox(database, householdId);
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
				if (
					aggregate.entityKind === 'meal' &&
					aggregate.aggregate.deletedAt !== null &&
					!pendingKeys.has(key)
				) {
					await detachMealCheckIns(database, aggregate.entityId);
				}
			}
			for (const aggregate of decoded) {
				const local = localIntent.get(keyFor(aggregate.entityKind, aggregate.entityId));
				if (local !== undefined) await database.table(aggregate.store).put(local);
			}
			const current = await database.syncScopes.get(['household', householdId]);
			if (
				current?.cursor !== null &&
				current?.cursor !== undefined &&
				response.throughSequence < current.cursor
			) {
				throw new TypeError('A stale sync page cannot move the local cursor backwards.');
			}
			const next: SyncScopeRecord = {
				scopeKind: 'household',
				scopeId: householdId,
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
		}
	);
};

export const applyHouseholdMutationReceipts = async (
	database: MaalDatabase,
	householdId: string,
	receipts: readonly MutationReceipt[],
	now = new Date()
): Promise<void> => {
	const resolved = await Promise.all(
		receipts.map(async (receipt) => {
			const row = await database.outbox.get(receipt.mutationId);
			const authoritative =
				row && receipt.status === 'rejected' && row.authoritativeSnapshot !== undefined
					? decodeHouseholdSyncAggregate(
							row.entityKind as HouseholdSyncEntityKind,
							row.aggregateId,
							householdId,
							row.authoritativeSnapshot
						)
					: null;
			return { receipt, row, authoritative };
		})
	);
	const tables = resolved.flatMap(({ authoritative }) =>
		authoritative ? [database.table(authoritative.store)] : []
	);
	await database.transaction(
		'rw',
		[...new Set(tables), database.mealCheckIns, database.outbox],
		async () => {
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
				if (!authoritative) continue;
				await database.table(authoritative.store).put(authoritative.aggregate);
				if (authoritative.entityKind === 'meal' && authoritative.aggregate.deletedAt !== null) {
					await detachMealCheckIns(database, authoritative.entityId);
				}
			}
		}
	);
};

export const applyHouseholdBootstrap = async (
	database: MaalDatabase,
	householdId: string,
	response: HouseholdBootstrapResponse,
	now = new Date()
): Promise<void> => {
	// Bootstrap pages are sorted by stable entity key for pagination, not by commit sequence.
	const decoded = decodeChanges(householdId, response.aggregates, false);
	const tables = [...new Set(decoded.map(({ store }) => database.table(store)))];
	for (const instruction of response.instructions) {
		tables.push(database.table(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[instruction.entityKind].store));
	}
	await database.transaction(
		'rw',
		[...new Set(tables), database.mealCheckIns, database.outbox, database.syncScopes],
		async () => {
			const pending = await pendingHouseholdOutbox(database, householdId);
			const pendingKeys = new Set(pending.map((row) => keyFor(row.entityKind, row.aggregateId)));
			for (const aggregate of decoded) {
				const key = keyFor(aggregate.entityKind, aggregate.entityId);
				if (pendingKeys.has(key)) continue;
				await database.table(aggregate.store).put(aggregate.aggregate);
				if (aggregate.entityKind === 'meal' && aggregate.aggregate.deletedAt !== null) {
					await detachMealCheckIns(database, aggregate.entityId);
				}
			}
			for (const instruction of response.instructions) {
				const key = keyFor(instruction.entityKind, instruction.entityId);
				if (instruction.action !== 'delete_acknowledged_absence' || pendingKeys.has(key)) continue;
				await database
					.table(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[instruction.entityKind].store)
					.delete(instruction.entityId);
				if (instruction.entityKind === 'meal') {
					await detachMealCheckIns(database, instruction.entityId);
				}
			}
			const current = await database.syncScopes.get(['household', householdId]);
			await database.syncScopes.put({
				scopeKind: 'household',
				scopeId: householdId,
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

const belongsToHousehold = async (
	database: MaalDatabase,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	record: Record<string, unknown>
): Promise<boolean> => {
	if (entityKind !== 'meal_check_in') return record.householdId === householdId;
	if (typeof record.mealId === 'string') {
		const meal = await database.meals.get(record.mealId);
		return meal?.householdId === householdId;
	}
	return (await database.outbox.toArray()).some(
		(row) =>
			row.scopeKind === 'household' &&
			row.scopeId === householdId &&
			row.entityKind === entityKind &&
			row.aggregateId === record.id
	);
};

export const buildHouseholdSnapshotManifest = async (
	database: MaalDatabase,
	householdId: string
): Promise<HouseholdSnapshotManifestEntry[]> => {
	const acknowledged = new Set(
		(await database.outbox.toArray())
			.filter(
				(row) =>
					row.scopeKind === 'household' &&
					row.scopeId === householdId &&
					row.status === 'acknowledged'
			)
			.map((row) => keyFor(row.entityKind, row.aggregateId))
	);
	const manifest: HouseholdSnapshotManifestEntry[] = [];
	for (const [entityKind, descriptor] of Object.entries(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS) as [
		HouseholdSyncEntityKind,
		(typeof HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS)[HouseholdSyncEntityKind]
	][]) {
		const records = (await database.table(descriptor.store).toArray()) as Record<string, unknown>[];
		for (const record of records) {
			if (!(await belongsToHousehold(database, householdId, entityKind, record))) continue;
			const entityId = entityKind === 'household' ? record.householdId : record.id;
			const decoded = decodeHouseholdSyncAggregate(
				entityKind,
				String(entityId),
				householdId,
				record
			);
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
