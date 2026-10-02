import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	acquireSyncLease,
	releaseSyncLease,
	renewSyncLease,
	type SyncLease
} from '$lib/client/local/leases.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { markProfileReauthRequired } from '$lib/client/local/profiles.js';
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
	type SyncMutation,
	type UserSyncEntityKind
} from '$lib/sync/contracts.js';
import {
	decodeUserSyncAggregate,
	readConflictGroupsForMutation,
	USER_SYNC_ENTITY_DESCRIPTORS
} from '$lib/sync/user-entities.js';

import {
	applyUserBootstrap,
	applyUserMutationReceipts,
	applyUserPullPage,
	buildUserSnapshotManifest
} from './apply.js';
import { resolveLocalUserSyncCapability, type LocalUserSyncCapability } from './capability.js';
import {
	byOccurrence,
	coalesceOutbox,
	coveredRows,
	deletionGroupFor,
	expandReceipts,
	firstRejectionCode,
	markSending,
	pushIsolatingRejections,
	requeue,
	requeueUnanswered,
	retryDelay,
	scopeOutbox,
	type CoalescedMutation,
	type OutboxAggregate,
	type PushOutcome
} from './outbox.js';
import type { UserSyncTransport } from './transport.js';

export const BACKFILL_BATCH_SIZE = 25;
export const BACKFILL_MAX_BYTES = 256 * 1024;
export const BACKFILL_SINGLE_RECORD_MAX_BYTES = 1024 * 1024;
export const BACKFILL_INTERVAL_MS = 30_000;
/** How often a paid, visible, online scope pulls when nothing else triggers a run. */
export const FOREGROUND_PULL_INTERVAL_MS = 60_000;
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

const backfillFlag = (record: OutboxRecord): boolean => record.backfill === true;

/** Every due interactive row of the scope, oldest first. Rows of other auth slots stay put. */
const selectInteractiveOutbox = async (
	database: MaalDatabase,
	authSlotId: string,
	workosUserId: string,
	now: Date
): Promise<OutboxRecord[]> =>
	(await scopeOutbox(database, 'user', workosUserId))
		.filter(
			(row) =>
				row.authSlotId === authSlotId &&
				!backfillFlag(row) &&
				Date.parse(row.nextAttemptAt) <= now.getTime()
		)
		.toSorted(byOccurrence);

const loadAggregate = async (
	database: MaalDatabase,
	workosUserId: string,
	row: OutboxRecord
): Promise<OutboxAggregate> => {
	const entityKind = Schema.decodeUnknownSync(UserSyncEntityKindSchema)(row.entityKind);
	const descriptor = USER_SYNC_ENTITY_DESCRIPTORS[entityKind];
	const source = row.snapshot ?? (await database.table(descriptor.store).get(row.aggregateId));
	return {
		aggregate: decodeUserSyncAggregate(entityKind, row.aggregateId, workosUserId, source).aggregate,
		deletionGroup: deletionGroupFor(descriptor.conflictGroups)
	};
};

const toMutation = ({
	host,
	conflictGroups,
	operation,
	aggregate
}: CoalescedMutation): SyncMutation => ({
	schemaVersion: CURRENT_SCHEMA_VERSION,
	mutationId: host.mutationId,
	originDeviceId: host.originDeviceId,
	entityKind: Schema.decodeUnknownSync(UserSyncEntityKindSchema)(host.entityKind),
	entityId: host.aggregateId,
	conflictGroups,
	operation,
	occurredAt: host.occurredAt,
	aggregate
});

/** Backfill rows carry their own snapshot and groups, so they are sent exactly as prepared. */
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
	(await scopeOutbox(database, 'user', workosUserId)).filter(
		(row) => row.authSlotId === authSlotId && backfillFlag(row)
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
		const terminalRows: OutboxRecord[] = [];
		const mutations: SyncMutation[] = [];
		let requestCheckpoint: BackfillCheckpoint = {
			entityKind,
			lastAggregateId: checkpoint?.lastAggregateId ?? null,
			processedCount: checkpoint?.processedCount ?? 0
		};
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
				clockGroups.length > 0
					? clockGroups
					: [...USER_SYNC_ENTITY_DESCRIPTORS[entityKind].conflictGroups];
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
			const requestBytes = new TextEncoder().encode(
				JSON.stringify({
					protocolVersion: CURRENT_PROTOCOL_VERSION,
					deviceId,
					audience: { kind: 'user', id: workosUserId },
					checkpoint: requestCheckpoint,
					mutations: [...mutations, mutation]
				})
			).byteLength;
			if (requestBytes > BACKFILL_SINGLE_RECORD_MAX_BYTES) {
				if (rows.length > 0) break;
				terminalRows.push({
					mutationId,
					authSlotId,
					scopeKind: 'user',
					scopeId: workosUserId,
					status: 'rejected',
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
					rejectionCode: 'backfill_payload_too_large',
					acknowledgedAt: utc(now),
					backfillConflictGroups,
					backfillPreviousId: requestCheckpoint.lastAggregateId,
					backfillProcessedCount: requestCheckpoint.processedCount
				});
				requestCheckpoint = {
					...requestCheckpoint,
					lastAggregateId: mutation.entityId,
					processedCount: requestCheckpoint.processedCount + 1
				};
				continue;
			}
			if (
				rows.length > 0 &&
				(rows.length >= BACKFILL_BATCH_SIZE || requestBytes > BACKFILL_MAX_BYTES)
			) {
				break;
			}
			mutations.push(mutation);
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
				backfillPreviousId: requestCheckpoint.lastAggregateId,
				backfillProcessedCount: requestCheckpoint.processedCount
			});
		}
		if (rows.length === 0 && terminalRows.length === 0) return null;
		if (rows.length === 0) {
			await database.transaction('rw', database.outbox, database.backfillCheckpoints, async () => {
				await database.outbox.bulkAdd(terminalRows);
				await database.backfillCheckpoints.put({
					scopeKind: 'user',
					scopeId: workosUserId,
					entityKind,
					priorityBoundary: null,
					lastAggregateId: requestCheckpoint.lastAggregateId,
					processedCount: requestCheckpoint.processedCount,
					state: 'complete',
					lastAttemptAt: utc(now)
				});
			});
			continue;
		}
		await database.transaction('rw', database.outbox, database.backfillCheckpoints, async () => {
			await database.outbox.bulkAdd([...terminalRows, ...rows]);
			await database.backfillCheckpoints.put({
				scopeKind: 'user',
				scopeId: workosUserId,
				entityKind,
				priorityBoundary: null,
				lastAggregateId: requestCheckpoint.lastAggregateId,
				processedCount: requestCheckpoint.processedCount,
				state: 'running',
				lastAttemptAt: utc(now)
			});
		});
		return {
			rows,
			checkpoint: requestCheckpoint
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
	let deniedCapability: string | null = null;
	let retryAttempt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let timerDueAt = 0;
	let unsubscribe: (() => void)[] = [];
	const applyScope = { authSlotId: options.authSlotId, workosUserId: options.workosUserId };

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
				await applyUserPullPage(options.database, applyScope, response, now());
				if (!response.hasMore) return;
			} catch (error) {
				if (!(error instanceof SyncBootstrapRequired)) throw error;
				const manifest = await buildUserSnapshotManifest(options.database, options.workosUserId);
				let afterEntityKey: string | null = null;
				// Each page is a fresh snapshot, so an edit committed between pages can sit below the
				// last page's sequence. The cursor stays at the first page's so the next pull gets it.
				let throughSequence = Number.POSITIVE_INFINITY;
				do {
					const response = await options.transport.bootstrap(options.authSlotId, {
						protocolVersion: CURRENT_PROTOCOL_VERSION,
						deviceId: id,
						audience: { kind: 'user', id: options.workosUserId },
						manifest,
						afterEntityKey,
						limit: PULL_PAGE_SIZE
					});
					throughSequence = Math.min(throughSequence, response.throughSequence);
					await applyUserBootstrap(
						options.database,
						applyScope,
						{ ...response, throughSequence },
						now()
					);
					afterEntityKey = response.nextEntityKey;
				} while (afterEntityKey !== null);
			}
		}
	};

	/** Sends one batch of coalesced rows. Null means nothing was due. */
	const pushInteractive = async (
		id: string,
		aggregates: Map<string, OutboxAggregate>
	): Promise<PushOutcome | null> => {
		const rows = await selectInteractiveOutbox(
			options.database,
			options.authSlotId,
			options.workosUserId,
			now()
		);
		if (rows.length === 0) return null;
		const planned = await coalesceOutbox(
			rows,
			(row) => loadAggregate(options.database, options.workosUserId, row),
			aggregates
		);
		const sent = coveredRows(planned);
		await markSending(options.database, sent);
		try {
			const scope = await options.database.syncScopes.get(['user', options.workosUserId]);
			const pushed = await pushIsolatingRejections(planned.map(toMutation), (mutations) =>
				options.transport.push(options.authSlotId, {
					protocolVersion: CURRENT_PROTOCOL_VERSION,
					deviceId: id,
					audience: { kind: 'user', id: options.workosUserId },
					baseCursor: scope?.cursor ?? null,
					mutations: [...mutations]
				})
			);
			const receipts = expandReceipts(planned, pushed.receipts);
			await applyUserMutationReceipts(options.database, options.workosUserId, receipts, now());
			await requeueUnanswered(options.database, sent, receipts, now(), BACKFILL_INTERVAL_MS);
			return {
				committedThrough: pushed.committedThrough,
				rejectionCode: firstRejectionCode(receipts)
			};
		} catch (error) {
			await requeue(options.database, sent, now(), BACKFILL_INTERVAL_MS);
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
			await applyUserMutationReceipts(
				options.database,
				options.workosUserId,
				response.receipts,
				now()
			);
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
			await requeue(options.database, prepared.rows, now(), BACKFILL_INTERVAL_MS);
			throw error;
		}
	};

	/**
	 * The memberships and billing rows the user capability is decided from. A server denial holds
	 * until these change, so a plan refresh resumes sync and an unchanged retry costs no request.
	 */
	const capabilityInputs = async (): Promise<{ householdIds: string[]; fingerprint: string }> => {
		const memberships = (
			await options.database.memberships
				.where('[workosUserId+status]')
				.equals([options.workosUserId, 'active'])
				.toArray()
		)
			.filter(({ permissions }) => permissions.includes('recipes:read'))
			.toSorted((left, right) => left.householdId.localeCompare(right.householdId));
		const householdIds = memberships.map(({ householdId }) => householdId);
		const capabilities = await options.database.billingCapabilities.bulkGet(householdIds);
		return {
			householdIds,
			fingerprint: JSON.stringify([memberships.map(({ permissions }) => permissions), capabilities])
		};
	};

	const markTerminal = async (error: unknown): Promise<void> => {
		if (error instanceof SyncUnauthenticated) {
			terminalBlocked = true;
			currentState = 'reauthRequired';
			await markProfileReauthRequired(options.database, options.authSlotId);
		} else {
			currentState = 'blocked';
			// Only this user's households decide this scope; other profiles' households are untouched.
			const { householdIds } = await capabilityInputs();
			await options.database.transaction('rw', options.database.billingCapabilities, async () => {
				for (const householdId of householdIds) {
					await options.database.billingCapabilities.update(householdId, { stale: true });
				}
			});
			deniedCapability = (await capabilityInputs()).fingerprint;
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
		if (deniedCapability !== null) {
			if ((await capabilityInputs()).fingerprint === deniedCapability) {
				return (currentState = 'blocked');
			}
			deniedCapability = null;
		}
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
			// Drain: every batch moves its rows out of the due set, so this ends.
			let pushed = false;
			let rejectionCode: string | null = null;
			const aggregates = new Map<string, OutboxAggregate>();
			let outcome = await pushInteractive(id, aggregates);
			while (outcome !== null) {
				pushed ||= outcome.committedThrough !== null;
				rejectionCode ??= outcome.rejectionCode;
				lease = await renew(lease);
				outcome = await pushInteractive(id, aggregates);
			}
			if (pushed) await pullAll(id);
			lease = await renew(lease);
			const backfilledThrough = await runBackfill(id);
			if (backfilledThrough !== null) await pullAll(id);
			currentState = 'complete';
			retryAttempt = 0;
			await options.database.syncScopes.update(['user', options.workosUserId], {
				state: 'idle',
				lastSuccessAt: utc(now()),
				lastErrorCode: rejectionCode
			});
			schedule(backfilledThrough === null ? FOREGROUND_PULL_INTERVAL_MS : BACKFILL_INTERVAL_MS);
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
		if (!started || terminalBlocked) return;
		const dueAt = Date.now() + delay;
		if (timer !== null) {
			if (dueAt >= timerDueAt) return;
			clearTimeout(timer);
		}
		timerDueAt = dueAt;
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
			retryAttempt = 0;
			schedule();
		},
		state: () => currentState
	};
};
