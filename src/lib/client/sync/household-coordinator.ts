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
	type MutationReceipt
} from '$lib/sync/contracts.js';
import {
	HOUSEHOLD_SYNC_ENTITY_KINDS,
	HouseholdSyncEntityKindSchema,
	type HouseholdBackfillCheckpoint,
	type HouseholdSyncEntityKind,
	type HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';
import {
	assertHouseholdMutationActor,
	decodeHouseholdSyncAggregate,
	HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS
} from '$lib/sync/household-entities.js';

import {
	applyHouseholdBootstrap,
	applyHouseholdPullPage,
	buildHouseholdSnapshotManifest
} from './household-apply.js';
import {
	resolveLocalHouseholdSyncCapability,
	type LocalHouseholdSyncCapability
} from './household-capability.js';
import type { HouseholdSyncTransport } from './household-transport.js';
import type { UserSyncEnvironment } from './coordinator.js';

const PUSH_BATCH_SIZE = 50;
export const HOUSEHOLD_BACKFILL_BATCH_SIZE = 25;
export const HOUSEHOLD_BACKFILL_MAX_BYTES = 256 * 1024;
export const HOUSEHOLD_BACKFILL_INTERVAL_MS = 30_000;
const LEASE_TTL_MS = 60_000;
const PULL_PAGE_SIZE = 100;

const BACKFILL_ENTITY_ORDER: readonly HouseholdSyncEntityKind[] = [
	'meal',
	'meal_check_in',
	'householdAppliance',
	'foodHouseholdEntry',
	'foodHouseholdAlias',
	'unitHouseholdEntry',
	'unitHouseholdAlias',
	'householdFoodDisplayPreference',
	'householdUnitDisplayPreference'
];

export type HouseholdSyncRunState =
	'disabled' | 'offline' | 'hidden' | 'busy' | 'complete' | 'blocked' | 'reauthRequired';

export interface HouseholdSyncCoordinatorOptions {
	readonly database: MaalDatabase;
	readonly authSlotId: string;
	readonly workosUserId: string;
	readonly householdId: string;
	readonly transport: HouseholdSyncTransport;
	readonly environment?: UserSyncEnvironment;
	readonly capabilityResolver?: (
		database: MaalDatabase,
		workosUserId: string,
		householdId: string,
		now: Date
	) => Promise<LocalHouseholdSyncCapability>;
	readonly now?: () => Date;
	readonly coordinatorId?: string;
}

export interface HouseholdSyncCoordinator {
	start(): void;
	stop(): void;
	syncNow(): Promise<HouseholdSyncRunState>;
	notifyLocalMutation(): void;
	resumeAfterCapabilityRefresh(): void;
	state(): HouseholdSyncRunState;
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
const retryDelay = (attempt: number): number => Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
const backfillFlag = (record: OutboxRecord): boolean => record.backfill === true;
const isHouseholdEntityKind = (kind: string): kind is HouseholdSyncEntityKind =>
	(HOUSEHOLD_SYNC_ENTITY_KINDS as readonly string[]).includes(kind);

const selectInteractiveOutbox = async (
	database: MaalDatabase,
	authSlotId: string,
	householdId: string,
	now: Date
): Promise<OutboxRecord[]> =>
	(await database.outbox.toArray())
		.filter(
			(row) =>
				row.authSlotId === authSlotId &&
				row.scopeKind === 'household' &&
				row.scopeId === householdId &&
				isHouseholdEntityKind(row.entityKind) &&
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
	householdId: string,
	workosUserId: string,
	row: OutboxRecord
): Promise<HouseholdSyncMutation> => {
	const entityKind = Schema.decodeUnknownSync(HouseholdSyncEntityKindSchema)(row.entityKind);
	const source =
		row.snapshot ??
		(await database
			.table(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[entityKind].store)
			.get(row.aggregateId));
	const decoded = decodeHouseholdSyncAggregate(entityKind, row.aggregateId, householdId, source);
	assertHouseholdMutationActor(entityKind, workosUserId, decoded.aggregate);
	const storedGroups = Array.isArray(row.backfillConflictGroups)
		? row.backfillConflictGroups.filter((group): group is string => typeof group === 'string')
		: [];
	const clocks = decoded.aggregate.conflictClocks;
	const clockGroups =
		typeof clocks === 'object' && clocks !== null && !Array.isArray(clocks)
			? Object.entries(clocks)
					.filter(([, value]) => {
						if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
						return (value as { mutationId?: unknown }).mutationId === row.mutationId;
					})
					.map(([group]) => group)
			: [];
	const conflictGroups =
		storedGroups.length > 0
			? storedGroups
			: clockGroups.length > 0
				? clockGroups
				: [row.conflictGroup];
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		mutationId: row.mutationId,
		originDeviceId: row.originDeviceId,
		entityKind,
		entityId: row.aggregateId,
		conflictGroups: conflictGroups as [string, ...string[]],
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

const markSending = async (
	database: MaalDatabase,
	rows: readonly OutboxRecord[]
): Promise<void> => {
	await database.transaction('rw', database.outbox, async () => {
		for (const row of rows) await database.outbox.update(row.mutationId, { status: 'sending' });
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
				? Math.max(HOUSEHOLD_BACKFILL_INTERVAL_MS, retryDelay(attempts))
				: retryDelay(attempts);
			await database.outbox.update(row.mutationId, {
				status: 'pending',
				attempts,
				nextAttemptAt: utc(new Date(now.getTime() + delay))
			});
		}
	});
};

const priorityKeyFor = (
	entityKind: HouseholdSyncEntityKind,
	record: Record<string, unknown>,
	now: Date
): string => {
	if (entityKind !== 'meal') return `5:${String(record.id)}`;
	const date = typeof record.date === 'string' ? record.date : null;
	if (date === null) return `4:${String(record.id)}`;
	const today = now.toISOString().slice(0, 10);
	if (date >= today) return `0:${date}:${String(record.id)}`;
	const inverse = String(9_999_999_999_999 - Date.parse(`${date}T00:00:00.000Z`)).padStart(13, '0');
	return `1:${inverse}:${String(record.id)}`;
};

const belongsToHousehold = async (
	database: MaalDatabase,
	householdId: string,
	workosUserId: string,
	entityKind: HouseholdSyncEntityKind,
	record: Record<string, unknown>
): Promise<boolean> => {
	if (entityKind !== 'meal_check_in') return record.householdId === householdId;
	if (record.reporterUserId !== workosUserId) return false;
	if (typeof record.mealId !== 'string') return false;
	const meal = await database.meals.get(record.mealId);
	return meal?.householdId === householdId;
};

const recordsForBackfill = async (
	database: MaalDatabase,
	householdId: string,
	workosUserId: string,
	entityKind: HouseholdSyncEntityKind,
	checkpoint: BackfillCheckpointRecord | undefined,
	now: Date
): Promise<{ record: Record<string, unknown>; priorityKey: string }[]> => {
	const descriptor = HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[entityKind];
	const rows = (await database.table(descriptor.store).toArray()) as Record<string, unknown>[];
	const selected: { record: Record<string, unknown>; priorityKey: string }[] = [];
	for (const record of rows) {
		if (!(await belongsToHousehold(database, householdId, workosUserId, entityKind, record)))
			continue;
		const priorityKey = priorityKeyFor(entityKind, record, now);
		if (priorityKey <= (checkpoint?.priorityBoundary ?? '')) continue;
		selected.push({ record, priorityKey });
	}
	return selected.toSorted((left, right) => left.priorityKey.localeCompare(right.priorityKey));
};

const prepareBackfill = async (
	database: MaalDatabase,
	authSlotId: string,
	workosUserId: string,
	householdId: string,
	deviceId: string,
	now: Date
): Promise<{ rows: OutboxRecord[]; checkpoint: HouseholdBackfillCheckpoint } | null> => {
	const existing = (await database.outbox.toArray()).filter(
		(row) =>
			row.authSlotId === authSlotId &&
			row.scopeKind === 'household' &&
			row.scopeId === householdId &&
			backfillFlag(row) &&
			(row.status === 'pending' || row.status === 'sending')
	);
	if (existing.length > 0) {
		const due = existing
			.filter((row) => Date.parse(row.nextAttemptAt) <= now.getTime())
			.toSorted((a, b) =>
				String(a.backfillPriorityKey).localeCompare(String(b.backfillPriorityKey))
			);
		if (due.length === 0) return null;
		const first = due[0]!;
		return {
			rows: due.slice(0, HOUSEHOLD_BACKFILL_BATCH_SIZE),
			checkpoint: {
				entityKind: Schema.decodeUnknownSync(HouseholdSyncEntityKindSchema)(first.entityKind),
				lastAggregateId: (first.backfillPreviousId as string | null | undefined) ?? null,
				processedCount: Number(first.backfillProcessedCount ?? 0),
				priorityBoundary: (first.backfillPreviousPriority as string | null | undefined) ?? null
			}
		};
	}

	for (const entityKind of BACKFILL_ENTITY_ORDER) {
		const key: [string, string, string] = ['household', householdId, entityKind];
		const checkpoint = await database.backfillCheckpoints.get(key);
		if (checkpoint?.state === 'complete') continue;
		if (
			checkpoint?.lastAttemptAt &&
			now.getTime() - Date.parse(checkpoint.lastAttemptAt) < HOUSEHOLD_BACKFILL_INTERVAL_MS
		) {
			return null;
		}
		const records = await recordsForBackfill(
			database,
			householdId,
			workosUserId,
			entityKind,
			checkpoint,
			now
		);
		if (records.length === 0) {
			await database.backfillCheckpoints.put({
				scopeKind: 'household',
				scopeId: householdId,
				entityKind,
				priorityBoundary: checkpoint?.priorityBoundary ?? null,
				lastAggregateId: checkpoint?.lastAggregateId ?? null,
				processedCount: checkpoint?.processedCount ?? 0,
				state: 'complete',
				lastAttemptAt: utc(now)
			});
			continue;
		}

		const rows: OutboxRecord[] = [];
		const mutations: HouseholdSyncMutation[] = [];
		const requestCheckpoint: HouseholdBackfillCheckpoint = {
			entityKind,
			lastAggregateId: checkpoint?.lastAggregateId ?? null,
			processedCount: checkpoint?.processedCount ?? 0,
			priorityBoundary: checkpoint?.priorityBoundary ?? null
		};
		for (const { record, priorityKey } of records) {
			const decoded = decodeHouseholdSyncAggregate(
				entityKind,
				String(record.id),
				householdId,
				record
			);
			assertHouseholdMutationActor(entityKind, workosUserId, decoded.aggregate);
			const mutationId = uuidv7();
			const clocks = decoded.aggregate.conflictClocks;
			const conflictGroups =
				typeof clocks === 'object' && clocks !== null && !Array.isArray(clocks)
					? Object.keys(clocks)
					: [];
			const groups = conflictGroups.length > 0 ? conflictGroups : ['aggregate'];
			const mutation: HouseholdSyncMutation = {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId,
				originDeviceId: deviceId,
				entityKind,
				entityId: decoded.entityId,
				conflictGroups: groups as [string, ...string[]],
				operation: decoded.aggregate.deletedAt === null ? 'upsert' : 'delete',
				occurredAt: decoded.aggregate.updatedAt as `${string}Z`,
				aggregate: decoded.aggregate
			};
			const requestBytes = new TextEncoder().encode(
				JSON.stringify({
					protocolVersion: CURRENT_PROTOCOL_VERSION,
					deviceId,
					audience: { kind: 'household', id: householdId },
					checkpoint: requestCheckpoint,
					mutations: [...mutations, mutation]
				})
			).byteLength;
			if (
				rows.length > 0 &&
				(rows.length >= HOUSEHOLD_BACKFILL_BATCH_SIZE ||
					requestBytes > HOUSEHOLD_BACKFILL_MAX_BYTES)
			) {
				break;
			}
			if (requestBytes > HOUSEHOLD_BACKFILL_MAX_BYTES) continue;
			mutations.push(mutation);
			rows.push({
				mutationId,
				authSlotId,
				scopeKind: 'household',
				scopeId: householdId,
				status: 'pending',
				occurredAt: mutation.occurredAt,
				aggregateId: mutation.entityId,
				entityKind,
				conflictGroup: groups[0]!,
				operation: mutation.operation,
				originDeviceId: deviceId,
				payload: null,
				nextAttemptAt: utc(now),
				attempts: 0,
				backfill: true,
				snapshot: decoded.aggregate,
				backfillConflictGroups: groups,
				backfillPriorityKey: priorityKey,
				backfillPreviousPriority: checkpoint?.priorityBoundary ?? null,
				backfillPreviousId: checkpoint?.lastAggregateId ?? null,
				backfillProcessedCount: checkpoint?.processedCount ?? 0
			});
		}
		if (rows.length === 0) return null;
		await database.transaction('rw', database.outbox, database.backfillCheckpoints, async () => {
			await database.outbox.bulkAdd(rows);
			await database.backfillCheckpoints.put({
				scopeKind: 'household',
				scopeId: householdId,
				entityKind,
				priorityBoundary: checkpoint?.priorityBoundary ?? null,
				lastAggregateId: checkpoint?.lastAggregateId ?? null,
				processedCount: checkpoint?.processedCount ?? 0,
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

export const createHouseholdSyncCoordinator = (
	options: HouseholdSyncCoordinatorOptions
): HouseholdSyncCoordinator => {
	const environment = options.environment ?? browserEnvironment();
	const resolveCapability = options.capabilityResolver ?? resolveLocalHouseholdSyncCapability;
	const now = options.now ?? (() => new Date());
	const coordinatorId = options.coordinatorId ?? uuidv7();
	let currentState: HouseholdSyncRunState = 'disabled';
	let active: Promise<HouseholdSyncRunState> | null = null;
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
		if (!renewed)
			throw new SyncLeaseLost({ code: 'lease_lost', message: 'Another tab owns sync.' });
		return renewed;
	};

	const pullAll = async (id: string, renewLease: () => Promise<void>): Promise<void> => {
		for (;;) {
			const scope = await options.database.syncScopes.get(['household', options.householdId]);
			try {
				const response = await options.transport.pull(options.authSlotId, {
					protocolVersion: CURRENT_PROTOCOL_VERSION,
					deviceId: id,
					audience: { kind: 'household', id: options.householdId },
					after: scope?.cursor ?? 0,
					limit: PULL_PAGE_SIZE
				});
				await applyHouseholdPullPage(options.database, options.householdId, response, now());
				await renewLease();
				if (!response.hasMore) return;
			} catch (error) {
				if (!(error instanceof SyncBootstrapRequired)) throw error;
				const manifest = await buildHouseholdSnapshotManifest(
					options.database,
					options.householdId
				);
				let afterEntityKey: string | null = null;
				do {
					const response = await options.transport.bootstrap(options.authSlotId, {
						protocolVersion: CURRENT_PROTOCOL_VERSION,
						deviceId: id,
						audience: { kind: 'household', id: options.householdId },
						manifest,
						afterEntityKey,
						limit: PULL_PAGE_SIZE
					});
					await applyHouseholdBootstrap(options.database, options.householdId, response, now());
					await renewLease();
					afterEntityKey = response.nextEntityKey;
				} while (afterEntityKey !== null);
			}
		}
	};

	const pushInteractive = async (id: string): Promise<number | null> => {
		const rows = await selectInteractiveOutbox(
			options.database,
			options.authSlotId,
			options.householdId,
			now()
		);
		if (rows.length === 0) return null;
		const mutations = await Promise.all(
			rows.map((row) =>
				hydrateMutation(options.database, options.householdId, options.workosUserId, row)
			)
		);
		await markSending(options.database, rows);
		try {
			const scope = await options.database.syncScopes.get(['household', options.householdId]);
			const response = await options.transport.push(options.authSlotId, {
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: id,
				audience: { kind: 'household', id: options.householdId },
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
			options.householdId,
			id,
			now()
		);
		if (!prepared) return null;
		const mutations = await Promise.all(
			prepared.rows.map((row) =>
				hydrateMutation(options.database, options.householdId, options.workosUserId, row)
			)
		);
		await markSending(options.database, prepared.rows);
		try {
			const response = await options.transport.backfill(options.authSlotId, {
				protocolVersion: CURRENT_PROTOCOL_VERSION,
				deviceId: id,
				audience: { kind: 'household', id: options.householdId },
				checkpoint: prepared.checkpoint,
				mutations
			});
			await updateOutboxFromReceipts(options.database, response.receipts, now());
			const last = prepared.rows.at(-1)!;
			await options.database.backfillCheckpoints.put({
				scopeKind: 'household',
				scopeId: options.householdId,
				entityKind: prepared.checkpoint.entityKind,
				priorityBoundary: String(last.backfillPriorityKey),
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

	const markMembershipRevoked = async (code: string): Promise<void> => {
		const membership = await options.database.memberships
			.where('[householdId+workosUserId]')
			.equals([options.householdId, options.workosUserId])
			.first();
		const detachedAt = utc(now());
		await options.database.transaction(
			'rw',
			options.database.memberships,
			options.database.outbox,
			async () => {
				if (membership) {
					await options.database.memberships.update(membership.membershipId, {
						status: 'detached',
						detachedAt,
						denialCode: code,
						updatedAt: detachedAt
					});
				}
				for (const row of await options.database.outbox.toArray()) {
					if (
						row.authSlotId === options.authSlotId &&
						row.scopeKind === 'household' &&
						row.scopeId === options.householdId &&
						(row.status === 'pending' || row.status === 'sending')
					) {
						await options.database.outbox.update(row.mutationId, {
							status: 'quarantined',
							rejectionCode: code
						});
					}
				}
			}
		);
	};

	const markTerminal = async (error: SyncUnauthenticated | SyncPermissionDenied): Promise<void> => {
		terminalBlocked = true;
		if (error instanceof SyncUnauthenticated) {
			currentState = 'reauthRequired';
			await options.database.authSlots.update(options.authSlotId, {
				sessionState: 'reauthRequired'
			});
		} else {
			currentState = 'blocked';
			if (error.code === 'membership_required' || error.code === 'workos_membership_missing') {
				await markMembershipRevoked(error.code);
			}
		}
		await options.database.syncScopes.update(['household', options.householdId], {
			state: 'blocked',
			lastErrorCode: error.code
		});
	};

	const perform = async (): Promise<HouseholdSyncRunState> => {
		if (terminalBlocked) return currentState;
		if (!environment.isOnline()) return (currentState = 'offline');
		if (!environment.isVisible()) return (currentState = 'hidden');
		const capability = await resolveCapability(
			options.database,
			options.workosUserId,
			options.householdId,
			now()
		);
		if (!capability.enabled) return (currentState = 'disabled');
		const acquired = await acquireSyncLease(options.database, {
			scopeKind: 'household',
			scopeId: options.householdId,
			owner: coordinatorId,
			ttlMilliseconds: LEASE_TTL_MS,
			now: now()
		});
		if (!acquired) {
			currentState = 'busy';
			schedule(1_000);
			return currentState;
		}
		let lease = acquired;
		currentState = 'busy';
		await options.database.syncScopes.update(['household', options.householdId], {
			state: 'syncing'
		});
		try {
			const id = await deviceId();
			const renewCurrentLease = async (): Promise<void> => {
				lease = await renew(lease);
			};
			await pullAll(id, renewCurrentLease);
			const pushedThrough = await pushInteractive(id);
			await renewCurrentLease();
			if (pushedThrough !== null) await pullAll(id, renewCurrentLease);
			const backfilledThrough = await runBackfill(id);
			await renewCurrentLease();
			if (backfilledThrough !== null) {
				await pullAll(id, renewCurrentLease);
				schedule(HOUSEHOLD_BACKFILL_INTERVAL_MS);
			}
			currentState = 'complete';
			retryAttempt = 0;
			await options.database.syncScopes.update(['household', options.householdId], {
				state: 'idle',
				lastSuccessAt: utc(now()),
				lastErrorCode: null
			});
			return currentState;
		} catch (error) {
			if (error instanceof SyncCapabilityDenied) {
				await options.database.billingCapabilities.update(options.householdId, {
					state: 'disabled',
					stale: false,
					validUntil: utc(now())
				});
				currentState = 'disabled';
				return currentState;
			}
			if (error instanceof SyncUnauthenticated || error instanceof SyncPermissionDenied) {
				await markTerminal(error);
				return currentState;
			}
			await options.database.syncScopes.update(['household', options.householdId], {
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
	const run = (): Promise<HouseholdSyncRunState> => {
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
