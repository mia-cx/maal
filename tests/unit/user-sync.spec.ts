import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { acquireSyncLease, renewSyncLease } from '$lib/client/local/leases.js';
import {
	BACKFILL_SINGLE_RECORD_MAX_BYTES,
	applyUserMutationReceipts,
	applyUserPullPage,
	createUserSyncCoordinator,
	applyUserBootstrap,
	type UserSyncEnvironment,
	type UserSyncTransport
} from '$lib/client/sync/index.js';
import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import { UnitUserEntrySchema, type UnitUserEntry } from '$lib/domain/taxonomy/schema.js';
import {
	PullResponseSchema,
	SyncBootstrapRequired,
	SyncCapabilityDenied,
	SyncTransportError,
	SyncUnauthenticated,
	type BackfillRequest,
	type BootstrapRequest,
	type BootstrapResponse,
	type PullRequest,
	type PushRequest,
	type SyncChange
} from '$lib/sync/contracts.js';
import {
	BACKFILL_CLOCK_SKEW_MS,
	incomingWinsHistoricalConflict
} from '$lib/server/sync/reconciliation.js';
import {
	bootstrapUserSync,
	pullUserSync,
	pushUserSync,
	reconciliationInstructions,
	syncEntityKey,
	type UserSyncRepository
} from '$lib/server/sync/index.js';

const databases: MaalDatabase[] = [];
const timestamp = '2026-08-21T12:00:00.000Z' as const;
const userId = 'user_alice';
const authSlotId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`user-sync-${crypto.randomUUID()}`);
	databases.push(database);
	return database;
};

afterEach(async () => {
	for (const database of databases) {
		const name = database.name;
		database.close();
		await Dexie.delete(name);
	}
	databases.length = 0;
});

const environment = (
	overrides: Partial<{ online: boolean; visible: boolean; saveData: boolean }> = {}
): UserSyncEnvironment => ({
	isOnline: () => overrides.online ?? true,
	isVisible: () => overrides.visible ?? true,
	isSaveDataEnabled: () => overrides.saveData ?? true,
	on: () => () => undefined
});

const userUnit = (overrides: Partial<UnitUserEntry> = {}): UnitUserEntry =>
	Schema.decodeUnknownSync(UnitUserEntrySchema)({
		id: uuidv7(),
		workosUserId: userId,
		canonicalLabel: 'my spoon',
		baseUnitId: 'grams',
		toBaseFactor: 3.5,
		toBaseOffset: 0,
		adoptionStatus: 'accepted',
		schemaVersion: 1,
		revision: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		deletedAt: null,
		conflictClocks: {},
		...overrides
	});

const seedPaidProfile = async (database: MaalDatabase): Promise<void> => {
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
		householdId: 'household_paid',
		workosUserId: userId,
		roleSlug: 'admin',
		permissions: ['recipes:read', 'recipes:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: timestamp,
		lastVerifiedAt: timestamp,
		updatedAt: timestamp,
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
	await database.billingCapabilities.put({
		householdId: 'household_paid',
		state: 'enabled',
		stripeStatus: 'active',
		subscriberUserId: userId,
		stripePriceId: 'price_test',
		currentPeriodEnd: '2026-09-21T12:00:00.000Z',
		interruptionStartedAt: null,
		graceUntil: null,
		validUntil: '2026-09-21T12:00:00.000Z',
		cancelAtPeriodEnd: false,
		stale: false,
		source: 'stripe-d1'
	});
};

const emptyPull = (after = 0) => ({
	protocolVersion: CURRENT_PROTOCOL_VERSION,
	changes: [],
	throughSequence: after,
	retainedFloor: 0,
	bootstrapGeneration: 1,
	hasMore: false
});

const noOpTransport = (): UserSyncTransport => ({
	pull: async (_slot, request) => emptyPull(request.after),
	push: async () => ({ protocolVersion: 1, receipts: [], committedThrough: 0 }),
	bootstrap: async () => ({
		protocolVersion: 1,
		aggregates: [],
		instructions: [],
		throughSequence: 0,
		retainedFloor: 0,
		bootstrapGeneration: 1,
		hasMore: false,
		nextEntityKey: null
	}),
	backfill: async (_slot, request) => ({
		protocolVersion: 1,
		receipts: [],
		committedThrough: 0,
		checkpoint: request.checkpoint
	})
});

describe('versioned user sync contracts', () => {
	test('rejects unknown protocol versions and malformed complete aggregates', () => {
		expect(() =>
			Schema.decodeUnknownSync(PullResponseSchema)({ ...emptyPull(), protocolVersion: 2 })
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(UnitUserEntrySchema)({ ...userUnit(), toBaseFactor: Number.NaN })
		).toThrow();
	});
});

describe('foreground user coordinator', () => {
	test('applies entity-key bootstrap pages whose commit sequences are not monotonic', async () => {
		const database = await openDatabase();
		const [firstId, secondId] = [uuidv7(), uuidv7()].toSorted();
		const first = userUnit({ id: firstId, canonicalLabel: 'first spoon' });
		const second = userUnit({ id: secondId, canonicalLabel: 'second spoon' });

		await applyUserBootstrap(database, userId, {
			protocolVersion: 1,
			aggregates: [
				{
					sequence: 2,
					mutationId: uuidv7(),
					originDeviceId: uuidv7(),
					entityKind: 'unitUserEntry',
					entityId: firstId,
					conflictGroups: ['row'],
					operation: 'upsert',
					resultingRevision: 1,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate: first,
					tombstoneExpiresAt: null
				},
				{
					sequence: 1,
					mutationId: uuidv7(),
					originDeviceId: uuidv7(),
					entityKind: 'unitUserEntry',
					entityId: secondId,
					conflictGroups: ['row'],
					operation: 'upsert',
					resultingRevision: 1,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate: second,
					tombstoneExpiresAt: null
				}
			],
			instructions: [],
			throughSequence: 2,
			retainedFloor: 0,
			bootstrapGeneration: 1,
			hasMore: false,
			nextEntityKey: null
		});

		expect(await database.unitUserEntries.bulkGet([firstId, secondId])).toEqual([first, second]);
	});

	test('proves routine free use generates zero sync Worker or D1 transport requests', async () => {
		const database = await openDatabase();
		const row = userUnit();
		await database.unitUserEntries.put(row);
		await database.outbox.put({
			mutationId: uuidv7(),
			authSlotId,
			scopeKind: 'user',
			scopeId: userId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: row.id,
			entityKind: 'unitUserEntry',
			conflictGroup: 'row',
			operation: 'upsert',
			originDeviceId: uuidv7(),
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});
		const transport = noOpTransport();
		const pull = vi.spyOn(transport, 'pull');
		const push = vi.spyOn(transport, 'push');
		const bootstrap = vi.spyOn(transport, 'bootstrap');
		const backfill = vi.spyOn(transport, 'backfill');
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment()
		});

		await expect(coordinator.syncNow()).resolves.toBe('disabled');
		expect({
			pull: pull.mock.calls.length,
			push: push.mock.calls.length,
			bootstrap: bootstrap.mock.calls.length,
			backfill: backfill.mock.calls.length
		}).toEqual({
			pull: 0,
			push: 0,
			bootstrap: 0,
			backfill: 0
		});
	});

	test('stops an active cached capability at validUntil without content traffic', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		await database.billingCapabilities.update('household_paid', { validUntil: timestamp });
		const transport = noOpTransport();
		const requests = [
			vi.spyOn(transport, 'pull'),
			vi.spyOn(transport, 'push'),
			vi.spyOn(transport, 'bootstrap'),
			vi.spyOn(transport, 'backfill')
		];
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment(),
			now: () => new Date(timestamp)
		});

		await expect(coordinator.syncNow()).resolves.toBe('disabled');
		expect(requests.map(({ mock }) => mock.calls.length)).toEqual([0, 0, 0, 0]);
	});

	test('pulls, applies to Dexie, pushes immutable intent, then pulls through its D1 sequence', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const row = userUnit();
		const mutationId = uuidv7();
		const originDeviceId = uuidv7();
		const aggregate = {
			...row,
			conflictClocks: { row: { mutationId, originDeviceId, occurredAt: timestamp } }
		};
		await database.unitUserEntries.put(aggregate);
		await database.outbox.put({
			mutationId,
			authSlotId,
			scopeKind: 'user',
			scopeId: userId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: row.id,
			entityKind: 'unitUserEntry',
			conflictGroup: 'row',
			operation: 'upsert',
			originDeviceId,
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});
		const calls: string[] = [];
		let committed: SyncChange | null = null;
		const transport: UserSyncTransport = {
			pull: async (_slot, request) => {
				calls.push(`pull:${request.after}`);
				return committed && request.after < 1
					? { ...emptyPull(1), changes: [committed] }
					: emptyPull(request.after);
			},
			push: async (_slot, request) => {
				calls.push('push');
				expect(request.mutations[0]).toMatchObject({
					mutationId,
					entityId: row.id,
					conflictGroups: ['row'],
					aggregate
				});
				committed = {
					sequence: 1,
					mutationId,
					originDeviceId,
					entityKind: 'unitUserEntry',
					entityId: row.id,
					conflictGroups: ['row'],
					operation: 'upsert',
					resultingRevision: 1,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate,
					tombstoneExpiresAt: null
				};
				return {
					protocolVersion: 1,
					receipts: [{ mutationId, status: 'accepted', sequence: 1, resultingRevision: 1 }],
					committedThrough: 1
				};
			},
			bootstrap: noOpTransport().bootstrap,
			backfill: noOpTransport().backfill
		};
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment()
		});

		await expect(coordinator.syncNow()).resolves.toBe('complete');
		expect(calls).toEqual(['pull:0', 'push', 'pull:0']);
		await expect(database.outbox.get(mutationId)).resolves.toMatchObject({
			status: 'acknowledged',
			acknowledgedSequence: 1
		});
		await expect(database.syncScopes.get(['user', userId])).resolves.toMatchObject({
			cursor: 1,
			state: 'idle'
		});
		await expect(database.unitUserEntries.get(row.id)).resolves.toEqual(aggregate);
	});

	test('reveals a masked authoritative aggregate when the pending mutation is rejected', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const entityId = uuidv7();
		const mutationId = uuidv7();
		const originDeviceId = uuidv7();
		const local = userUnit({
			id: entityId,
			canonicalLabel: 'local spoon',
			conflictClocks: { row: { mutationId, originDeviceId, occurredAt: timestamp } }
		});
		const remoteMutationId = uuidv7();
		const remote = userUnit({
			id: entityId,
			canonicalLabel: 'remote spoon',
			revision: 2,
			conflictClocks: {
				row: { mutationId: remoteMutationId, originDeviceId: uuidv7(), occurredAt: timestamp }
			}
		});
		await database.unitUserEntries.put(local);
		await database.outbox.put({
			mutationId,
			authSlotId,
			scopeKind: 'user',
			scopeId: userId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: entityId,
			entityKind: 'unitUserEntry',
			conflictGroup: 'row',
			operation: 'upsert',
			originDeviceId,
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});
		const transport = noOpTransport();
		transport.pull = async (_slot, request) =>
			request.after === 0
				? {
						...emptyPull(1),
						changes: [
							{
								sequence: 1,
								mutationId: remoteMutationId,
								originDeviceId: remote.conflictClocks.row!.originDeviceId,
								entityKind: 'unitUserEntry',
								entityId,
								conflictGroups: ['row'],
								operation: 'upsert',
								resultingRevision: 2,
								occurredAt: timestamp,
								receivedAt: timestamp,
								aggregate: remote,
								tombstoneExpiresAt: null
							}
						]
					}
				: emptyPull(request.after);
		transport.push = async () => ({
			protocolVersion: 1,
			receipts: [
				{
					mutationId,
					status: 'rejected',
					sequence: null,
					resultingRevision: null,
					errorCode: 'historical_loser'
				}
			],
			committedThrough: 1
		});
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment()
		});

		await expect(coordinator.syncNow()).resolves.toBe('complete');
		await expect(database.outbox.get(mutationId)).resolves.toMatchObject({
			status: 'rejected',
			rejectionCode: 'historical_loser'
		});
		await expect(database.unitUserEntries.get(entityId)).resolves.toEqual(remote);
	});

	test('keeps a newer pending intent until every mutation masking the remote aggregate is rejected', async () => {
		const database = await openDatabase();
		const entityId = uuidv7();
		const firstMutationId = uuidv7();
		const secondMutationId = uuidv7();
		const originDeviceId = uuidv7();
		const local = userUnit({ id: entityId, canonicalLabel: 'latest local spoon' });
		const remote = userUnit({ id: entityId, canonicalLabel: 'remote spoon', revision: 2 });
		await database.unitUserEntries.put(local);
		await database.outbox.bulkPut(
			[firstMutationId, secondMutationId].map((mutationId) => ({
				mutationId,
				authSlotId,
				scopeKind: 'user' as const,
				scopeId: userId,
				status: 'pending' as const,
				occurredAt: timestamp,
				aggregateId: entityId,
				entityKind: 'unitUserEntry',
				conflictGroup: 'row',
				operation: 'upsert' as const,
				originDeviceId,
				payload: {},
				nextAttemptAt: timestamp,
				attempts: 0
			}))
		);
		await applyUserPullPage(database, userId, {
			...emptyPull(1),
			changes: [
				{
					sequence: 1,
					mutationId: uuidv7(),
					originDeviceId: uuidv7(),
					entityKind: 'unitUserEntry',
					entityId,
					conflictGroups: ['row'],
					operation: 'upsert',
					resultingRevision: 2,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate: remote,
					tombstoneExpiresAt: null
				}
			]
		});

		const rejected = (mutationId: string) => ({
			mutationId,
			status: 'rejected' as const,
			sequence: null,
			resultingRevision: null,
			errorCode: 'historical_loser'
		});
		await applyUserMutationReceipts(database, userId, [rejected(secondMutationId)]);
		await expect(database.unitUserEntries.get(entityId)).resolves.toEqual(local);

		await applyUserMutationReceipts(database, userId, [rejected(firstMutationId)]);
		await expect(database.unitUserEntries.get(entityId)).resolves.toEqual(remote);
	});

	test('does not leave Dexie or its cursor half-applied when a remote aggregate is malformed', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const transport = noOpTransport();
		transport.pull = async () => ({
			...emptyPull(4),
			changes: [
				{
					sequence: 4,
					mutationId: uuidv7(),
					originDeviceId: uuidv7(),
					entityKind: 'unitUserEntry',
					entityId: uuidv7(),
					conflictGroups: ['row'],
					operation: 'upsert',
					resultingRevision: 1,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate: { private: 'malformed' },
					tombstoneExpiresAt: null
				}
			]
		});
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment()
		});

		await expect(coordinator.syncNow()).rejects.toMatchObject({ _tag: 'LocalDecodeError' });
		await expect(database.syncScopes.get(['user', userId])).resolves.toMatchObject({
			cursor: null
		});
		await expect(database.unitUserEntries.count()).resolves.toBe(0);
	});

	test('bootstraps an expired cursor and applies authoritative deletion instructions', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const row = userUnit();
		await database.unitUserEntries.put(row);
		await database.outbox.put({
			mutationId: uuidv7(),
			authSlotId,
			scopeKind: 'user',
			scopeId: userId,
			status: 'acknowledged',
			occurredAt: timestamp,
			aggregateId: row.id,
			entityKind: 'unitUserEntry',
			conflictGroup: 'row',
			operation: 'upsert',
			originDeviceId: uuidv7(),
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});
		const transport = noOpTransport();
		transport.pull = vi.fn(async (_slot, request) => {
			if (request.after === 0)
				throw new SyncBootstrapRequired({
					code: 'cursor_expired',
					message: 'expired',
					retainedFloor: 3,
					bootstrapGeneration: 2
				});
			return {
				...emptyPull(request.after),
				retainedFloor: 3,
				bootstrapGeneration: 2
			};
		});
		transport.bootstrap = vi.fn(
			async (_slot, request: BootstrapRequest): Promise<BootstrapResponse> => {
				expect(request.manifest).toContainEqual(
					expect.objectContaining({ entityId: row.id, previousServerAck: true })
				);
				return {
					protocolVersion: 1,
					aggregates: [],
					instructions: [
						{ entityKind: 'unitUserEntry', entityId: row.id, action: 'delete_acknowledged_absence' }
					],
					throughSequence: 3,
					retainedFloor: 3,
					bootstrapGeneration: 2,
					hasMore: false,
					nextEntityKey: null
				};
			}
		);
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment()
		});

		await expect(coordinator.syncNow()).resolves.toBe('complete');
		await expect(database.unitUserEntries.get(row.id)).resolves.toBeUndefined();
		await expect(database.syncScopes.get(['user', userId])).resolves.toMatchObject({
			cursor: 3,
			bootstrapGeneration: 2
		});
	});

	test.each([
		[new SyncUnauthenticated({ code: 'expired', message: 'expired' }), 'reauthRequired'],
		[new SyncCapabilityDenied({ code: 'lapsed', message: 'lapsed' }), 'blocked']
	] as const)('stops on terminal auth/capability failures', async (failure, state) => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const transport = noOpTransport();
		transport.pull = async () => {
			throw failure;
		};
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment()
		});
		await expect(coordinator.syncNow()).resolves.toBe(state);
		await expect(coordinator.syncNow()).resolves.toBe(state);
		if (state === 'reauthRequired') {
			await expect(database.authSlots.get(authSlotId)).resolves.toMatchObject({
				sessionState: 'reauthRequired'
			});
		}
	});

	test('does not call transport while offline', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const transport = noOpTransport();
		const pull = vi.spyOn(transport, 'pull');
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment({ online: false })
		});
		await expect(coordinator.syncNow()).resolves.toBe('offline');
		expect(pull).not.toHaveBeenCalled();
	});

	test('requeues an interrupted immutable mutation with bounded exponential retry metadata', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const row = userUnit();
		const mutationId = uuidv7();
		const originDeviceId = uuidv7();
		await database.unitUserEntries.put({
			...row,
			conflictClocks: { row: { mutationId, originDeviceId, occurredAt: timestamp } }
		});
		await database.outbox.put({
			mutationId,
			authSlotId,
			scopeKind: 'user',
			scopeId: userId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: row.id,
			entityKind: 'unitUserEntry',
			conflictGroup: 'row',
			operation: 'upsert',
			originDeviceId,
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});
		const transport = noOpTransport();
		transport.push = async () => {
			throw new SyncTransportError({
				code: 'network_unavailable',
				message: 'offline',
				retryable: true
			});
		};
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment(),
			now: () => new Date(timestamp)
		});

		await expect(coordinator.syncNow()).rejects.toMatchObject({ _tag: 'SyncTransportError' });
		await expect(database.outbox.get(mutationId)).resolves.toMatchObject({
			mutationId,
			status: 'pending',
			attempts: 1,
			nextAttemptAt: '2026-08-21T12:00:02.000Z'
		});
	});

	test('renews only the owning tab lease and excludes a competing coordinator', async () => {
		const database = await openDatabase();
		const acquired = await acquireSyncLease(database, {
			scopeKind: 'user',
			scopeId: userId,
			owner: 'tab-a',
			ttlMilliseconds: 1_000,
			now: new Date(timestamp)
		});
		expect(acquired).not.toBeNull();
		await expect(
			renewSyncLease(database, {
				scopeKind: 'user',
				scopeId: userId,
				owner: 'tab-a',
				ttlMilliseconds: 5_000,
				now: new Date(timestamp)
			})
		).resolves.toMatchObject({ owner: 'tab-a', expiresAt: '2026-08-21T12:00:05.000Z' });
		await expect(
			renewSyncLease(database, {
				scopeKind: 'user',
				scopeId: userId,
				owner: 'tab-b',
				ttlMilliseconds: 5_000,
				now: new Date(timestamp)
			})
		).resolves.toBeNull();
	});

	test('uploads historical snapshots in a bounded, slow, checkpointed batch', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		await database.unitUserEntries.bulkPut(
			Array.from({ length: 30 }, (_, index) =>
				userUnit({
					id: uuidv7(),
					canonicalLabel: `spoon ${String(index).padStart(2, '0')}`
				})
			)
		);
		let backfillRequest: BackfillRequest | null = null;
		const transport = noOpTransport();
		transport.backfill = async (_slot, request) => {
			backfillRequest = request;
			return {
				protocolVersion: 1,
				receipts: request.mutations.map((mutation, index) => ({
					mutationId: mutation.mutationId,
					status: 'accepted' as const,
					sequence: index + 1,
					resultingRevision: 1
				})),
				committedThrough: request.mutations.length,
				checkpoint: {
					...request.checkpoint,
					processedCount: request.mutations.length,
					lastAggregateId: request.mutations.at(-1)?.entityId ?? null
				}
			};
		};
		transport.pull = async (_slot, request) => emptyPull(request.after);
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment({ saveData: false }),
			now: () => new Date(timestamp)
		});

		await expect(coordinator.syncNow()).resolves.toBe('complete');
		expect(backfillRequest).not.toBeNull();
		expect(backfillRequest!.mutations.length).toBeLessThanOrEqual(25);
		expect(
			new TextEncoder().encode(JSON.stringify(backfillRequest)).byteLength
		).toBeLessThanOrEqual(256 * 1024);
		expect(backfillRequest!.mutations.every(({ occurredAt }) => occurredAt === timestamp)).toBe(
			true
		);
		const calls = vi.spyOn(transport, 'backfill');
		await coordinator.syncNow();
		expect(calls).not.toHaveBeenCalled();
	});

	test('persists an oversized backfill result and uploads the later record', async () => {
		const database = await openDatabase();
		await seedPaidProfile(database);
		const [oversizedId, laterId] = [uuidv7(), uuidv7()].toSorted();
		await database.unitUserEntries.bulkPut([
			userUnit({
				id: oversizedId,
				canonicalLabel: 'x'.repeat(BACKFILL_SINGLE_RECORD_MAX_BYTES + 1_024)
			}),
			userUnit({ id: laterId, canonicalLabel: 'later spoon' })
		]);
		const transport = noOpTransport();
		const backfill = vi.fn<UserSyncTransport['backfill']>(async (_slot, request) => ({
			protocolVersion: 1,
			receipts: request.mutations.map((mutation) => ({
				mutationId: mutation.mutationId,
				status: 'accepted' as const,
				sequence: 1,
				resultingRevision: 1
			})),
			committedThrough: 1,
			checkpoint: request.checkpoint
		}));
		transport.backfill = backfill;
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId: userId,
			transport,
			environment: environment({ saveData: false }),
			now: () => new Date(timestamp)
		});

		await expect(coordinator.syncNow()).resolves.toBe('complete');
		expect(backfill).toHaveBeenCalledTimes(1);
		expect(backfill.mock.calls[0]?.[1].mutations.map(({ entityId }) => entityId)).toEqual([
			laterId
		]);
		expect(
			(await database.outbox.toArray()).find(({ aggregateId }) => aggregateId === oversizedId)
		).toMatchObject({
			status: 'rejected',
			rejectionCode: 'backfill_payload_too_large',
			backfill: true
		});
		await expect(
			database.backfillCheckpoints.get(['user', userId, 'unitUserEntry'])
		).resolves.toMatchObject({ lastAggregateId: laterId, processedCount: 2 });
	});
});

describe('server ordering and bootstrap rules', () => {
	test('prevalidates every user mutation before the repository writes the first one', async () => {
		const commit = vi.fn();
		const repository = {
			readScopeState: async () => ({ retainedFloor: 0, latestSequence: 0, bootstrapGeneration: 1 }),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			commit,
			prune: vi.fn()
		} satisfies UserSyncRepository;
		const validAggregate = userUnit();
		const validMutation = {
			schemaVersion: 1 as const,
			mutationId: uuidv7(),
			originDeviceId: uuidv7(),
			entityKind: 'unitUserEntry' as const,
			entityId: validAggregate.id,
			conflictGroups: ['row'] as [string, ...string[]],
			operation: 'upsert' as const,
			occurredAt: timestamp,
			aggregate: validAggregate
		};
		const request = {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'user', id: userId },
			baseCursor: null,
			mutations: [
				validMutation,
				{ ...validMutation, mutationId: uuidv7(), entityId: uuidv7(), aggregate: { bad: true } }
			]
		} as unknown as PushRequest;

		await expect(pushUserSync(repository, userId, request)).rejects.toMatchObject({
			_tag: 'SyncMalformedRequest'
		});
		expect(commit).not.toHaveBeenCalled();
	});

	test.each([
		[
			'unknown conflict group',
			(mutation: PushRequest['mutations'][number]) => ({
				...mutation,
				conflictGroups: ['surprise'] as [string, ...string[]]
			})
		],
		[
			'operation/deletion mismatch',
			(mutation: PushRequest['mutations'][number]) => ({
				...mutation,
				operation: 'delete' as const
			})
		]
	])('rejects an %s before the first user repository write', async (_label, invalidate) => {
		const commit = vi.fn();
		const repository = {
			readScopeState: async () => ({ retainedFloor: 0, latestSequence: 0, bootstrapGeneration: 1 }),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			commit,
			prune: vi.fn()
		} satisfies UserSyncRepository;
		const aggregate = userUnit();
		const mutation: PushRequest['mutations'][number] = {
			schemaVersion: 1,
			mutationId: uuidv7(),
			originDeviceId: uuidv7(),
			entityKind: 'unitUserEntry',
			entityId: aggregate.id,
			conflictGroups: ['row'],
			operation: 'upsert',
			occurredAt: timestamp,
			aggregate
		};

		await expect(
			pushUserSync(repository, userId, {
				protocolVersion: 1,
				deviceId: uuidv7(),
				audience: { kind: 'user', id: userId },
				baseCursor: null,
				mutations: [mutation, invalidate({ ...mutation, mutationId: uuidv7() })]
			})
		).rejects.toMatchObject({ _tag: 'SyncMalformedRequest' });
		expect(commit).not.toHaveBeenCalled();
	});

	test('uses original UTC edit time only beyond the one-hour backfill threshold', () => {
		const current = { occurredAt: timestamp, originDeviceId: uuidv7(), mutationId: uuidv7() };
		expect(
			incomingWinsHistoricalConflict(current, {
				...current,
				occurredAt: '2026-08-21T10:59:59.999Z',
				mutationId: uuidv7()
			})
		).toBe(false);
		expect(
			incomingWinsHistoricalConflict(current, {
				...current,
				occurredAt: new Date(Date.parse(timestamp) - BACKFILL_CLOCK_SKEW_MS).toISOString(),
				mutationId: uuidv7()
			})
		).toBe(true);
		expect(
			incomingWinsHistoricalConflict(current, {
				...current,
				occurredAt: '2026-07-21T12:00:00.000Z',
				mutationId: uuidv7()
			})
		).toBe(false);
	});

	test('requires bootstrap below the retained D1 floor and distinguishes acknowledged absence', async () => {
		const repository = {
			readScopeState: async () => ({ retainedFloor: 5, latestSequence: 8, bootstrapGeneration: 3 }),
			pull: vi.fn(),
			bootstrap: async () => ({
				retainedFloor: 5,
				latestSequence: 8,
				bootstrapGeneration: 3,
				aggregates: [],
				authoritativeIds: new Set<string>()
			}),
			commit: vi.fn(),
			prune: vi.fn()
		} satisfies UserSyncRepository;
		const pullRequest: PullRequest = {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'user', id: userId },
			after: 4,
			limit: 100
		};
		await expect(pullUserSync(repository, userId, pullRequest)).rejects.toMatchObject({
			_tag: 'SyncBootstrapRequired',
			retainedFloor: 5,
			bootstrapGeneration: 3
		});
		expect(repository.pull).not.toHaveBeenCalled();

		const missing = uuidv7();
		const neverAcked = uuidv7();
		const instructions = reconciliationInstructions(
			[
				{
					entityKind: 'recipe',
					entityId: missing,
					revision: 1,
					updatedAt: timestamp,
					previousServerAck: true
				},
				{
					entityKind: 'recipe',
					entityId: neverAcked,
					revision: 1,
					updatedAt: timestamp,
					previousServerAck: false
				}
			],
			new Set()
		);
		expect(instructions).toEqual([
			{ entityKind: 'recipe', entityId: missing, action: 'delete_acknowledged_absence' },
			{ entityKind: 'recipe', entityId: neverAcked, action: 'keep_for_backfill' }
		]);
		expect(syncEntityKey('recipe', missing)).not.toBe(syncEntityKey('recipe', neverAcked));
	});

	test('rejects a user audience that does not match the authenticated WorkOS subject', async () => {
		const repository = {
			readScopeState: vi.fn(),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			commit: vi.fn(),
			prune: vi.fn()
		} as unknown as UserSyncRepository;
		const request: BootstrapRequest = {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'user', id: 'user_bob' },
			manifest: [],
			afterEntityKey: null,
			limit: 100
		};
		await expect(bootstrapUserSync(repository, userId, request)).rejects.toMatchObject({
			_tag: 'SyncIdentityMismatch'
		});
	});
});
