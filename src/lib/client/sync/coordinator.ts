import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	acquireSyncLease,
	releaseSyncLease,
	renewSyncLease,
	type SyncLease
} from '$lib/client/local/leases.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import type { BackfillCheckpointRecord, OutboxRecord } from '$lib/client/local/records.js';
import {
	CURRENT_PROTOCOL_VERSION,
	CURRENT_SCHEMA_VERSION
} from '$lib/domain/contracts/versions.js';
import {
	SyncBootstrapRequired,
	SyncCapabilityDenied,
	SyncLeaseLost,
	SyncPermissionDenied,
	SyncTransportError,
	SyncUnauthenticated,
	UserSyncEntityKindSchema,
	type BackfillCheckpoint,
	type MutationReceipt,
	type SyncMutation,
	type UserSyncEntityKind
} from '$lib/sync/contracts.js';
import {
	decodeUserSyncAggregate,
	readConflictGroupsForMutation,
	USER_SYNC_ENTITY_DESCRIPTORS
} from '$lib/sync/user-entities.js';

import { applyUserBootstrap, applyUserPullPage, buildUserSnapshotManifest } from './apply.js';
import { resolveLocalUserSyncCapability, type LocalUserSyncCapability } from './capability.js';
import type { UserSyncTransport } from './transport.js';

const PUSH_BATCH_SIZE = 50;
export const BACKFILL_BATCH_SIZE = 25;
export const BACKFILL_MAX_BYTES = 256 * 1024;
export const BACKFILL_INTERVAL_MS = 30_000;
const LEASE_TTL_MS = 20_000;
const PULL_PAGE_SIZE = 100;

const BACKFILL_ENTITY_ORDER: readonly UserSyncEntityKind[] = [
	'recipe',
	'foodUserEntry',
	'foodUserAlias',
	'unitUserEntry',
	'unitUserAlias',
	'userFoodPreference',
	'userFoodDisplayPreference',
	'userUnitDisplayPreference'
];

export type UserSyncRunState =
	'disabled' | 'offline' | 'hidden' | 'busy' | 'complete' | 'blocked' | 'reauthRequired';

export interface UserSyncEnvironment {
	isOnline(): boolean;
	isVisible(): boolean;
	isSaveDataEnabled(): boolean;
	on(event: 'online' | 'visible', listener: () => void): () => void;
}

export interface UserSyncCoordinatorOptions {
	readonly database: MaalDatabase;
	readonly authSlotId: string;
	readonly workosUserId: string;
	readonly transport: UserSyncTransport;
	readonly environment?: UserSyncEnvironment;
	readonly capabilityResolver?: (
		database: MaalDatabase,
		workosUserId: string,
		now: Date
	) => Promise<LocalUserSyncCapability>;
	readonly now?: () => Date;
	readonly coordinatorId?: string;
}

export interface UserSyncCoordinator {
	start(): void;
	stop(): void;
	syncNow(): Promise<UserSyncRunState>;
	notifyLocalMutation(): void;
	resumeAfterCapabilityRefresh(): void;
	state(): UserSyncRunState;
}

const browserEnvironment = (): UserSyncEnvironment => ({
	isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
	isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
	isSaveDataEnabled: () => {
		if (typeof navigator === 'undefined') return false;
		return Boolean(
			(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
		);
	},
	on: (event, listener) => {
		if (event === 'online') {
			if (typeof window === 'undefined') return () => undefined;
			window.addEventListener('online', listener);
			return () => window.removeEventListener('online', listener);
		}
		if (typeof document === 'undefined') return () => undefined;
		const visibilityListener = () => {
			if (document.visibilityState === 'visible') listener();
		};
		document.addEventListener('visibilitychange', visibilityListener);
		return () => document.removeEventListener('visibilitychange', visibilityListener);
	}
});

const utc = (date: Date): `${string}Z` => date.toISOString() as `${string}Z`;

const isTerminal = (error: unknown): boolean =>
	error instanceof SyncUnauthenticated ||
	error instanceof SyncCapabilityDenied ||
	error instanceof SyncPermissionDenied;

const retryDelay = (attempt: number): number => Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));

const backfillFlag = (record: OutboxRecord): boolean => record.backfill === true;

const selectInteractiveOutbox = async (
	database: MaalDatabase,
	authSlotId: string,
	workosUserId: string,
	now: Date
): Promise<OutboxRecord[]> =>
	(await database.outbox.toArray())
		.filter(
			(row) =>
				row.authSlotId === authSlotId &&
				row.scopeKind === 'user' &&
				row.scopeId === workosUserId &&
				!backfillFlag(row) &&
				(row.status === 'pending' || row.status === 'sending') &&
				Date.parse(row.nextAttemptAt) <= now.getTime()
		)
		.toSorted(
			(left, right) =>
				Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
				left.mutationId.localeCompare(right.mutationId)
		)
		.slice(0, PUSH_BATCH_SIZE);

const hydrateMutation = async (
	database: MaalDatabase,
	workosUserId: string,
	row: OutboxRecord
): Promise<SyncMutation> => {
	const entityKind = Schema.decodeUnknownSync(UserSyncEntityKindSchema)(row.entityKind);
	const source =
		row.snapshot ??
		(await database.table(USER_SYNC_ENTITY_DESCRIPTORS[entityKind].store).get(row.aggregateId));
	const decoded = decodeUserSyncAggregate(entityKind, row.aggregateId, workosUserId, source);
	const storedBackfillGroups = Array.isArray(row.backfillConflictGroups)
		? row.backfillConflictGroups.filter((group): group is string => typeof group === 'string')
		: [];
	const conflictGroups =
		storedBackfillGroups.length > 0
			? storedBackfillGroups
			: readConflictGroupsForMutation(decoded.aggregate, row.mutationId, row.conflictGroup);
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		mutationId: row.mutationId,
		originDeviceId: row.originDeviceId,
		entityKind,
		entityId: row.aggregateId,
		conflictGroups: [...conflictGroups] as [string, ...string[]],
		operation: row.operation,
		occurredAt: row.occurredAt,
		aggregate: decoded.aggregate
	};
};

const updateOutboxFromReceipts = async (
	database: MaalDatabase,
	receipts: readonly MutationReceipt[],
	now: Date
): Promise<void> => {
	await database.transaction('rw', database.outbox, async () => {
		for (const receipt of receipts) {
			const row = await database.outbox.get(receipt.mutationId);
			if (!row) continue;
			if (receipt.status === 'accepted' || receipt.status === 'duplicate') {
				await database.outbox.update(receipt.mutationId, {
					status: 'acknowledged',
					acknowledgedSequence: receipt.sequence,
					acknowledgedAt: utc(now)
				});
			} else if ('errorCode' in receipt) {
				await database.outbox.update(receipt.mutationId, {
					status: 'rejected',
					rejectionCode: receipt.errorCode,
					acknowledgedAt: utc(now)
				});
			}
		}
	});
};

const requeue = async (
	database: MaalDatabase,
	rows: readonly OutboxRecord[],
	now: Date
): Promise<void> => {
	await database.transaction('rw', database.outbox, async () => {
		for (const row of rows) {
			const attempts = row.attempts + 1;
			const delay = backfillFlag(row)
				? Math.max(BACKFILL_INTERVAL_MS, retryDelay(attempts))
				: retryDelay(attempts);
			await database.outbox.update(row.mutationId, {
				status: 'pending',
				attempts,
				nextAttemptAt: utc(new Date(now.getTime() + delay))
			});
		}
	});
};

const markSending = async (
	database: MaalDatabase,
	rows: readonly OutboxRecord[]
): Promise<void> => {
	await database.transaction('rw', database.outbox, async () => {
		for (const row of rows) await database.outbox.update(row.mutationId, { status: 'sending' });
	});
};

const checkpointKey = (
	workosUserId: string,
	entityKind: UserSyncEntityKind
): [string, string, string] => ['user', workosUserId, entityKind];

const recordsForBackfill = async (
	database: MaalDatabase,
	workosUserId: string,
	entityKind: UserSyncEntityKind,
	checkpoint: BackfillCheckpointRecord | undefined
): Promise<Record<string, unknown>[]> => {
	const descriptor = USER_SYNC_ENTITY_DESCRIPTORS[entityKind];
	const rows = (await database.table(descriptor.store).toArray()) as Record<string, unknown>[];
	return rows
		.filter((row) => {
			const owner = row.ownerUserId ?? row.workosUserId;
			return owner === workosUserId && String(row.id) > (checkpoint?.lastAggregateId ?? '');
		})
		.toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
};

const existingBackfillRows = async (
	database: MaalDatabase,
	authSlotId: string,
	workosUserId: string
): Promise<OutboxRecord[]> =>
	(await database.outbox.toArray()).filter(
		(row) =>
			row.authSlotId === authSlotId &&
			row.scopeKind === 'user' &&
			row.scopeId === workosUserId &&
			backfillFlag(row) &&
			(row.status === 'pending' || row.status === 'sending')
	);

const prepareBackfill = async (
	database: MaalDatabase,
	authSlotId: string,
	workosUserId: string,
	deviceId: string,
	now: Date
): Promise<{ rows: OutboxRecord[]; checkpoint: BackfillCheckpoint } | null> => {
	const existing = await existingBackfillRows(database, authSlotId, workosUserId);
	if (existing.length > 0) {
		const due = existing.filter((row) => Date.parse(row.nextAttemptAt) <= now.getTime());
		if (due.length === 0) return null;
		const first = due[0]!;
		return {
			rows: due.slice(0, BACKFILL_BATCH_SIZE),
			checkpoint: {
				entityKind: Schema.decodeUnknownSync(UserSyncEntityKindSchema)(first.entityKind),
				lastAggregateId: (first.backfillPreviousId as string | null | undefined) ?? null,
				processedCount: Number(first.backfillProcessedCount ?? 0)
			}
		};
	}

	for (const entityKind of BACKFILL_ENTITY_ORDER) {
		const key = checkpointKey(workosUserId, entityKind);
		const checkpoint = await database.backfillCheckpoints.get(key);
		if (checkpoint?.state === 'complete') continue;
		if (
			checkpoint?.lastAttemptAt &&
			now.getTime() - Date.parse(checkpoint.lastAttemptAt) < BACKFILL_INTERVAL_MS
		) {
			return null;
		}
		const records = await recordsForBackfill(database, workosUserId, entityKind, checkpoint);
		if (records.length === 0) {
			await database.backfillCheckpoints.put({
				scopeKind: 'user',
				scopeId: workosUserId,
				entityKind,
				priorityBoundary: null,
				lastAggregateId: checkpoint?.lastAggregateId ?? null,
				processedCount: checkpoint?.processedCount ?? 0,
				state: 'complete',
				lastAttemptAt: utc(now)
			});
			continue;
		}

		const rows: OutboxRecord[] = [];
		let byteCount = 0;
		for (const record of records) {
			const decoded = decodeUserSyncAggregate(entityKind, String(record.id), workosUserId, record);
			const mutationId = uuidv7();
			const clockGroups =
				typeof decoded.aggregate.conflictClocks === 'object' &&
				decoded.aggregate.conflictClocks !== null &&
				!Array.isArray(decoded.aggregate.conflictClocks)
					? Object.keys(decoded.aggregate.conflictClocks)
					: [];
			const backfillConflictGroups =
				clockGroups.length > 0 ? clockGroups : [entityKind === 'recipe' ? 'aggregate' : 'row'];
			const mutation: SyncMutation = {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId,
				originDeviceId: deviceId,
				entityKind,
				entityId: decoded.entityId,
				conflictGroups: backfillConflictGroups as [string, ...string[]],
				operation: decoded.aggregate.deletedAt === null ? 'upsert' : 'delete',
				occurredAt: decoded.aggregate.updatedAt as `${string}Z`,
				aggregate: decoded.aggregate
			};
			const bytes = new TextEncoder().encode(JSON.stringify(mutation)).byteLength;
			if (
				rows.length > 0 &&
				(rows.length >= BACKFILL_BATCH_SIZE || byteCount + bytes > BACKFILL_MAX_BYTES)
			)
				break;
			if (bytes > BACKFILL_MAX_BYTES) continue;
			byteCount += bytes;
			rows.push({
				mutationId,
				authSlotId,
				scopeKind: 'user',
				scopeId: workosUserId,
				status: 'pending',
				occurredAt: mutation.occurredAt,
				aggregateId: mutation.entityId,
				entityKind,
				conflictGroup: mutation.conflictGroups[0],
				operation: mutation.operation,
				originDeviceId: deviceId,
				payload: null,
				nextAttemptAt: utc(now),
				attempts: 0,
				backfill: true,
				snapshot: decoded.aggregate,
				backfillConflictGroups,
				backfillPreviousId: checkpoint?.lastAggregateId ?? null,
				backfillProcessedCount: checkpoint?.processedCount ?? 0
			});
		}
		if (rows.length === 0) return null;
		await database.transaction('rw', database.outbox, database.backfillCheckpoints, async () => {
			await database.outbox.bulkAdd(rows);
			await database.backfillCheckpoints.put({
				scopeKind: 'user',
				scopeId: workosUserId,
				entityKind,
				priorityBoundary: null,
				lastAggregateId: checkpoint?.lastAggregateId ?? null,
				processedCount: checkpoint?.processedCount ?? 0,
				state: 'running',
				lastAttemptAt: utc(now)
			});
		});
		return {
			rows,
			checkpoint: {
				entityKind,
				lastAggregateId: checkpoint?.lastAggregateId ?? null,
				processedCount: checkpoint?.processedCount ?? 0
			}
		};
	}
	return null;
};

export const createUserSyncCoordinator = (
	options: UserSyncCoordinatorOptions
): UserSyncCoordinator => {
	const environment = options.environment ?? browserEnvironment();
	const resolveCapability = options.capabilityResolver ?? resolveLocalUserSyncCapability;
	const now = options.now ?? (() => new Date());
	const coordinatorId = options.coordinatorId ?? uuidv7();
	let currentState: UserSyncRunState = 'disabled';
	let active: Promise<UserSyncRunState> | null = null;
	let started = false;
	let terminalBlocked = false;
	let retryAttempt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let unsubscribe: (() => void)[] = [];

	const deviceId = async (): Promise<string> => {
		const record = await options.database.meta.get('deviceId');
		if (typeof record?.value !== 'string') throw new TypeError('The device ID is unavailable.');
		return record.value;
	};

	const renew = async (lease: SyncLease): Promise<SyncLease> => {
		const renewed = await renewSyncLease(options.database, {
			...lease,
			ttlMilliseconds: LEASE_TTL_MS,
			now: now()
		});
		if (!renewed) {
			throw new SyncLeaseLost({ code: 'lease_lost', message: 'Another tab owns this sync scope.' });
		}
		return renewed;
	};

	const pullAll = async (id: string): Promise<void> => {
		for (;;) {
			const scope = await options.database.syncScopes.get(['user', options.workosUserId]);
			try {
				const response = await options.transport.pull(options.authSlotId, {
					protocolVersion: CURRENT_PROTOCOL_VERSION,
					deviceId: id,
					audience: { kind: 'user', id: options.workosUserId },
					after: scope?.cursor ?? 0,
					limit: PULL_PAGE_SIZE
				});
				await applyUserPullPage(options.database, options.workosUserId, response, now());
				if (!response.hasMore) return;
			} catch (error) {
				if (!(error instanceof SyncBootstrapRequired)) throw error;
				const manifest = await buildUserSnapshotManifest(options.database, options.workosUserId);
				let afterEntityKey: string | null = null;
				do {
					const response = await options.transport.bootstrap(options.authSlotId, {
						protocolVersion: CURRENT_PROTOCOL_VERSION,
						deviceId: id,
						audience: { kind: 'user', id: options.workosUserId },
						manifest,
						afterEntityKey,
						limit: PULL_PAGE_SIZE
					});
					await applyUserBootstrap(options.database, options.workosUserId, response, now());
					afterEntityKey = response.nextEntityKey;
				} while (afterEntityKey !== null);
			}
		}
	};

	const pushInteractive = async (id: string): Promise<number | null> => {
		const rows = await selectInteractiveOutbox(
			options.database,
			options.authSlotId,
			options.workosUserId,
			now()
		);
		if (rows.length === 0) return null;
		const mutations = await Promise.all(
			rows.map((row) => hydrateMutation(options.database, options.workosUserId, row))
		);
		await markSending(options.database, rows);
		try {
			const scope = await options.database.syncScopes.get(['user', options.workosUserId]);
			const response = await options.transport.push(options.authSlotId, {
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: id,
				audience: { kind: 'user', id: options.workosUserId },
				baseCursor: scope?.cursor ?? null,
				mutations
			});
			await updateOutboxFromReceipts(options.database, response.receipts, now());
			return response.committedThrough;
		} catch (error) {
			await requeue(options.database, rows, now());
			throw error;
		}
	};

	const runBackfill = async (id: string): Promise<number | null> => {
		if (environment.isSaveDataEnabled()) return null;
		const prepared = await prepareBackfill(
			options.database,
			options.authSlotId,
			options.workosUserId,
			id,
			now()
		);
		if (!prepared) return null;
		const mutations = await Promise.all(
			prepared.rows.map((row) => hydrateMutation(options.database, options.workosUserId, row))
		);
		await markSending(options.database, prepared.rows);
		try {
			const response = await options.transport.backfill(options.authSlotId, {
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: id,
				audience: { kind: 'user', id: options.workosUserId },
				checkpoint: prepared.checkpoint,
				mutations
			});
			await updateOutboxFromReceipts(options.database, response.receipts, now());
			const last = prepared.rows.at(-1)!;
			await options.database.backfillCheckpoints.put({
				scopeKind: 'user',
				scopeId: options.workosUserId,
				entityKind: prepared.checkpoint.entityKind,
				priorityBoundary: null,
				lastAggregateId: last.aggregateId,
				processedCount: prepared.checkpoint.processedCount + prepared.rows.length,
				state: 'pending',
				lastAttemptAt: utc(now())
			});
			return response.committedThrough;
		} catch (error) {
			await requeue(options.database, prepared.rows, now());
			throw error;
		}
	};

	const markTerminal = async (error: unknown): Promise<void> => {
		terminalBlocked = true;
		if (error instanceof SyncUnauthenticated) {
			currentState = 'reauthRequired';
			await options.database.authSlots.update(options.authSlotId, {
				sessionState: 'reauthRequired'
			});
		} else {
			currentState = 'blocked';
			const capabilities = await options.database.billingCapabilities.toArray();
			await options.database.transaction('rw', options.database.billingCapabilities, async () => {
				for (const capability of capabilities) {
					await options.database.billingCapabilities.update(capability.householdId, {
						stale: true
					});
				}
			});
		}
		await options.database.syncScopes.update(['user', options.workosUserId], {
			state: 'blocked',
			lastErrorCode:
				typeof error === 'object' && error !== null && 'code' in error
					? String(error.code)
					: 'sync_blocked'
		});
	};

	const perform = async (): Promise<UserSyncRunState> => {
		if (terminalBlocked) return currentState;
		if (!environment.isOnline()) return (currentState = 'offline');
		if (!environment.isVisible()) return (currentState = 'hidden');
		const capability = await resolveCapability(options.database, options.workosUserId, now());
		if (!capability.enabled) return (currentState = 'disabled');
		const acquired = await acquireSyncLease(options.database, {
			scopeKind: 'user',
			scopeId: options.workosUserId,
			owner: coordinatorId,
			ttlMilliseconds: LEASE_TTL_MS,
			now: now()
		});
		if (!acquired) return (currentState = 'busy');
		let lease = acquired;
		currentState = 'busy';
		await options.database.syncScopes.update(['user', options.workosUserId], { state: 'syncing' });
		try {
			const id = await deviceId();
			await pullAll(id);
			lease = await renew(lease);
			const pushedThrough = await pushInteractive(id);
			if (pushedThrough !== null) await pullAll(id);
			lease = await renew(lease);
			const backfilledThrough = await runBackfill(id);
			if (backfilledThrough !== null) await pullAll(id);
			currentState = 'complete';
			retryAttempt = 0;
			await options.database.syncScopes.update(['user', options.workosUserId], {
				state: 'idle',
				lastSuccessAt: utc(now()),
				lastErrorCode: null
			});
			return currentState;
		} catch (error) {
			if (isTerminal(error)) {
				await markTerminal(error);
				return currentState;
			}
			await options.database.syncScopes.update(['user', options.workosUserId], {
				state: error instanceof SyncBootstrapRequired ? 'bootstrapRequired' : 'idle',
				lastErrorCode:
					typeof error === 'object' && error !== null && 'code' in error
						? String(error.code)
						: 'sync_failed'
			});
			throw error;
		} finally {
			await releaseSyncLease(options.database, lease);
		}
	};

	const schedule = (delay = 0): void => {
		if (!started || terminalBlocked || timer !== null) return;
		timer = setTimeout(() => {
			timer = null;
			void run().catch((error: unknown) => {
				if (terminalBlocked || !started) return;
				const retryable = error instanceof SyncTransportError ? error.retryable : true;
				if (retryable) schedule(retryDelay(retryAttempt++));
			});
		}, delay);
	};

	const run = (): Promise<UserSyncRunState> => {
		active ??= perform().finally(() => {
			active = null;
		});
		return active;
	};

	return {
		start() {
			if (started) return;
			started = true;
			unsubscribe = [
				environment.on('online', () => schedule()),
				environment.on('visible', () => schedule())
			];
			schedule();
		},
		stop() {
			started = false;
			if (timer !== null) clearTimeout(timer);
			timer = null;
			for (const remove of unsubscribe) remove();
			unsubscribe = [];
		},
		syncNow: run,
		notifyLocalMutation() {
			schedule(250);
		},
		resumeAfterCapabilityRefresh() {
			terminalBlocked = false;
			retryAttempt = 0;
			schedule();
		},
		state: () => currentState
	};
};
