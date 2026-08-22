import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	HOUSEHOLD_BACKFILL_INTERVAL_MS,
	HOUSEHOLD_BACKFILL_MAX_BYTES,
	applyHouseholdBootstrap,
	createHouseholdSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncEnvironment
} from '$lib/client/sync/index.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { MealAggregateSchema, type MealAggregate } from '$lib/domain/meals/schema.js';
import { SyncPermissionDenied } from '$lib/sync/contracts.js';
import type {
	HouseholdBackfillRequest,
	HouseholdPullRequest,
	HouseholdSyncChange,
	HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';
import { pushHouseholdSync, type HouseholdSyncRepository } from '$lib/server/sync/index.js';

const householdId = 'org_family';
const timestamp = '2026-08-21T12:00:00.000Z' as const;
const databases: MaalDatabase[] = [];

const openDatabase = async (label: string): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`household-sync-${label}-${crypto.randomUUID()}`);
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

describe('household server request validation', () => {
	test('prevalidates every mutation before the repository writes the first one', async () => {
		const commit = vi.fn();
		const repository = {
			readScopeState: async () => ({ retainedFloor: 0, latestSequence: 0, bootstrapGeneration: 1 }),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			commit,
			prune: vi.fn()
		} satisfies HouseholdSyncRepository;
		const originDeviceId = uuidv7();
		const validAggregate = meal(uuidv7(), uuidv7(), originDeviceId);
		const validMutation: HouseholdSyncMutation = {
			schemaVersion: 1,
			mutationId: uuidv7(),
			originDeviceId,
			entityKind: 'meal',
			entityId: validAggregate.id,
			conflictGroups: ['schedule'],
			operation: 'upsert',
			occurredAt: timestamp,
			aggregate: validAggregate
		};

		await expect(
			pushHouseholdSync(repository, householdId, 'user_alice', {
				protocolVersion: 1,
				deviceId: originDeviceId,
				audience: { kind: 'household', id: householdId },
				baseCursor: null,
				mutations: [
					validMutation,
					{
						...validMutation,
						mutationId: uuidv7(),
						entityId: uuidv7(),
						aggregate: { bad: true }
					} as unknown as HouseholdSyncMutation
				]
			})
		).rejects.toMatchObject({ _tag: 'SyncMalformedRequest' });
		expect(commit).not.toHaveBeenCalled();
	});
});

const environment = (
	overrides: Partial<{ online: boolean; visible: boolean; saveData: boolean }> = {}
): UserSyncEnvironment => ({
	isOnline: () => overrides.online ?? true,
	isVisible: () => overrides.visible ?? true,
	isSaveDataEnabled: () => overrides.saveData ?? true,
	on: () => () => undefined
});

const meal = (
	id: string,
	mutationId: string,
	originDeviceId: string,
	overrides: Partial<MealAggregate> = {}
): MealAggregate =>
	Schema.decodeUnknownSync(MealAggregateSchema)({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		deletedAt: null,
		conflictClocks: {
			schedule: { occurredAt: timestamp, originDeviceId, mutationId }
		},
		id,
		householdId,
		sourceRecipeId: null,
		title: 'Family soup',
		description: null,
		imageUrl: null,
		date: '2026-08-22',
		time: '18:00',
		sortOrder: 0,
		plannedCookUserId: null,
		yield: 4,
		plannedYield: 4,
		status: 'planned',
		prepTimeMinutes: 5,
		cookTimeMinutes: 20,
		totalTimeMinutes: 25,
		sourceYieldText: 'Serves four',
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: 'en',
		sourceUrl: null,
		sourceSiteName: null,
		sourceAuthorName: null,
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		sourceImportedAt: timestamp,
		sourceHtmlHash: null,
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		sourceClaimedMinutes: 25,
		parseConfidence: 1,
		ingredientConfidence: 1,
		instructionConfidence: 1,
		nutritionConfidence: null,
		notes: null,
		ingredients: [],
		instructions: [],
		instructionEvents: [],
		applianceRequirements: [],
		classifications: [],
		media: [],
		nutritionFacts: [],
		...overrides
	});

const seedProfile = async (
	database: MaalDatabase,
	input: { userId: string; profileId: string; authSlotId: string; paid: boolean }
): Promise<void> => {
	await database.authSlots.put({
		authSlotId: input.authSlotId,
		profileId: input.profileId,
		workosUserId: input.userId,
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.memberships.put({
		membershipId: `membership_${input.userId}`,
		householdId,
		workosUserId: input.userId,
		roleSlug: 'member',
		permissions: ['meals:read', 'meals:write', 'households:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: timestamp,
		lastVerifiedAt: timestamp,
		updatedAt: timestamp,
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
	if (input.paid) {
		await database.billingCapabilities.put({
			householdId,
			state: 'enabled',
			stripeStatus: 'active',
			subscriberUserId: input.userId,
			stripePriceId: 'price_test',
			currentPeriodEnd: '2026-09-21T12:00:00.000Z',
			interruptionStartedAt: null,
			graceUntil: null,
			validUntil: '2026-09-21T12:00:00.000Z',
			cancelAtPeriodEnd: false,
			stale: false,
			source: 'stripe-d1'
		});
	}
};

const addLocalMealIntent = async (
	database: MaalDatabase,
	input: {
		mealId: string;
		mutationId: string;
		authSlotId: string;
		originDeviceId: string;
		date: string;
	}
): Promise<void> => {
	const aggregate = meal(input.mealId, input.mutationId, input.originDeviceId, {
		date: input.date as `${number}-${number}-${number}`
	});
	await database.transaction('rw', database.meals, database.outbox, async () => {
		await database.meals.put(aggregate);
		await database.outbox.put({
			mutationId: input.mutationId,
			authSlotId: input.authSlotId,
			scopeKind: 'household',
			scopeId: householdId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: input.mealId,
			entityKind: 'meal',
			conflictGroup: 'schedule',
			operation: 'upsert',
			originDeviceId: input.originDeviceId,
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});
	});
};

class MemoryHouseholdServer {
	private sequence = 0;
	private readonly changes: HouseholdSyncChange[] = [];
	private readonly receipts = new Map<string, { sequence: number; revision: number }>();

	transport(actorUserId: string): HouseholdSyncTransport {
		const push = async (mutations: readonly HouseholdSyncMutation[]) => {
			const receipts = mutations.map((mutation) => {
				const duplicate = this.receipts.get(mutation.mutationId);
				if (duplicate) {
					return {
						mutationId: mutation.mutationId,
						status: 'duplicate' as const,
						sequence: duplicate.sequence,
						resultingRevision: duplicate.revision
					};
				}
				const sequence = ++this.sequence;
				const revision = sequence;
				this.receipts.set(mutation.mutationId, { sequence, revision });
				this.changes.push({
					sequence,
					mutationId: mutation.mutationId,
					originDeviceId: mutation.originDeviceId,
					actorUserId,
					entityKind: mutation.entityKind,
					entityId: mutation.entityId,
					conflictGroups: mutation.conflictGroups,
					operation: mutation.operation,
					resultingRevision: revision,
					occurredAt: mutation.occurredAt,
					receivedAt: timestamp,
					aggregate: mutation.aggregate,
					tombstoneExpiresAt: null
				});
				return {
					mutationId: mutation.mutationId,
					status: 'accepted' as const,
					sequence,
					resultingRevision: revision
				};
			});
			return { protocolVersion: 1 as const, receipts, committedThrough: this.sequence };
		};
		return {
			pull: async (_slot, request: HouseholdPullRequest) => {
				const changes = this.changes.filter(({ sequence }) => sequence > request.after);
				return {
					protocolVersion: 1,
					changes,
					throughSequence: changes.at(-1)?.sequence ?? Math.min(request.after, this.sequence),
					retainedFloor: 0,
					bootstrapGeneration: 1,
					hasMore: false
				};
			},
			push: async (_slot, request) => push(request.mutations),
			bootstrap: async () => ({
				protocolVersion: 1,
				aggregates: [],
				instructions: [],
				throughSequence: this.sequence,
				retainedFloor: 0,
				bootstrapGeneration: 1,
				hasMore: false,
				nextEntityKey: null
			}),
			backfill: async (_slot, request: HouseholdBackfillRequest) => ({
				...(await push(request.mutations)),
				checkpoint: {
					...request.checkpoint,
					lastAggregateId: request.mutations.at(-1)?.entityId ?? request.checkpoint.lastAggregateId,
					processedCount: request.checkpoint.processedCount + request.mutations.length
				}
			})
		};
	}
}

describe('foreground household coordinator', () => {
	test('applies entity-key bootstrap pages whose commit sequences are not monotonic', async () => {
		const database = await openDatabase('bootstrap-key-order');
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		const [firstId, secondId] = [uuidv7(), uuidv7()].toSorted();
		const first = meal(firstId, uuidv7(), deviceId);
		const second = meal(secondId, uuidv7(), deviceId);
		await applyHouseholdBootstrap(database, householdId, {
			protocolVersion: 1,
			aggregates: [
				{
					sequence: 2,
					mutationId: uuidv7(),
					originDeviceId: deviceId,
					actorUserId: 'user_alice',
					entityKind: 'meal',
					entityId: firstId,
					conflictGroups: ['schedule'],
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
					originDeviceId: deviceId,
					actorUserId: 'user_bob',
					entityKind: 'meal',
					entityId: secondId,
					conflictGroups: ['schedule'],
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

		expect(await database.meals.bulkGet([firstId, secondId])).toEqual([first, second]);
	});

	test('makes zero content requests for an unpaid household', async () => {
		const database = await openDatabase('free');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: false
		});
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const spies = [
			vi.spyOn(transport, 'pull'),
			vi.spyOn(transport, 'push'),
			vi.spyOn(transport, 'bootstrap'),
			vi.spyOn(transport, 'backfill')
		];
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment({ saveData: false })
		});

		await expect(coordinator.syncNow()).resolves.toBe('disabled');
		expect(spies.map(({ mock }) => mock.calls.length)).toEqual([0, 0, 0, 0]);
	});

	test('pulls, reapplies local intent, pushes under its retained auth slot, then converges two devices', async () => {
		const server = new MemoryHouseholdServer();
		const alice = await openDatabase('alice');
		const bob = await openDatabase('bob');
		await seedProfile(alice, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		await seedProfile(bob, {
			userId: 'user_bob',
			profileId: 'profile_bob',
			authSlotId: 'slot_bob',
			paid: true
		});
		const mealId = uuidv7();
		const aliceDevice = String((await alice.meta.get('deviceId'))!.value);
		const bobDevice = String((await bob.meta.get('deviceId'))!.value);
		await addLocalMealIntent(alice, {
			mealId,
			mutationId: uuidv7(),
			authSlotId: 'slot_alice',
			originDeviceId: aliceDevice,
			date: '2026-08-23'
		});
		await addLocalMealIntent(bob, {
			mealId,
			mutationId: uuidv7(),
			authSlotId: 'slot_bob',
			originDeviceId: bobDevice,
			date: '2026-08-24'
		});
		const aliceCoordinator = createHouseholdSyncCoordinator({
			database: alice,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport: server.transport('user_alice'),
			environment: environment()
		});
		const bobTransport = server.transport('user_bob');
		const bobPush = vi.spyOn(bobTransport, 'push');
		const bobCoordinator = createHouseholdSyncCoordinator({
			database: bob,
			authSlotId: 'slot_bob',
			workosUserId: 'user_bob',
			householdId,
			transport: bobTransport,
			environment: environment()
		});

		await aliceCoordinator.syncNow();
		await bobCoordinator.syncNow();
		expect(bobPush.mock.calls[0]?.[1].mutations).toHaveLength(1);
		expect(bobPush.mock.calls[0]?.[1].mutations[0]?.aggregate).toMatchObject({
			date: '2026-08-24'
		});
		await aliceCoordinator.syncNow();
		expect(await alice.meals.get(mealId)).toMatchObject({ date: '2026-08-24' });
		expect(await bob.meals.get(mealId)).toMatchObject({ date: '2026-08-24' });
	});

	test('reveals a masked authoritative meal when the pending mutation is rejected', async () => {
		const database = await openDatabase('rejected-masked-pull');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const mealId = uuidv7();
		const mutationId = uuidv7();
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		await addLocalMealIntent(database, {
			mealId,
			mutationId,
			authSlotId: 'slot_alice',
			originDeviceId: deviceId,
			date: '2026-08-24'
		});
		const remoteMutationId = uuidv7();
		const remote = meal(mealId, remoteMutationId, uuidv7(), {
			date: '2026-08-23',
			revision: 2
		});
		const transport = new MemoryHouseholdServer().transport('user_alice');
		transport.pull = async (_slot, request) =>
			request.after === 0
				? {
						protocolVersion: 1,
						changes: [
							{
								sequence: 1,
								mutationId: remoteMutationId,
								originDeviceId: remote.conflictClocks.schedule!.originDeviceId,
								actorUserId: 'user_bob',
								entityKind: 'meal',
								entityId: mealId,
								conflictGroups: ['schedule'],
								operation: 'upsert',
								resultingRevision: 2,
								occurredAt: timestamp,
								receivedAt: timestamp,
								aggregate: remote,
								tombstoneExpiresAt: null
							}
						],
						throughSequence: 1,
						retainedFloor: 0,
						bootstrapGeneration: 1,
						hasMore: false
					}
				: {
						protocolVersion: 1,
						changes: [],
						throughSequence: request.after,
						retainedFloor: 0,
						bootstrapGeneration: 1,
						hasMore: false
					};
		transport.push = async () => ({
			protocolVersion: 1,
			receipts: [{ mutationId, status: 'rejected', errorCode: 'historical_loser' }],
			committedThrough: 1
		});
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment()
		});

		await expect(coordinator.syncNow()).resolves.toBe('complete');
		await expect(database.outbox.get(mutationId)).resolves.toMatchObject({
			status: 'rejected',
			rejectionCode: 'historical_loser'
		});
		await expect(database.meals.get(mealId)).resolves.toEqual(remote);
	});

	test('keeps lapse changes local, then reconciles them after resubscription', async () => {
		const database = await openDatabase('lapse');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: false
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		await addLocalMealIntent(database, {
			mealId: uuidv7(),
			mutationId: uuidv7(),
			authSlotId: 'slot_alice',
			originDeviceId: deviceId,
			date: '2026-08-25'
		});
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const pull = vi.spyOn(transport, 'pull');
		const push = vi.spyOn(transport, 'push');
		const backfill = vi.spyOn(transport, 'backfill');
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment()
		});
		await expect(coordinator.syncNow()).resolves.toBe('disabled');
		expect([pull.mock.calls.length, push.mock.calls.length, backfill.mock.calls.length]).toEqual([
			0, 0, 0
		]);
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		await expect(coordinator.syncNow()).resolves.toBe('complete');
		expect(pull).toHaveBeenCalledTimes(2);
		expect(push).toHaveBeenCalledTimes(1);
		expect(pull.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
		expect(push.mock.invocationCallOrder[0]).toBeLessThan(pull.mock.invocationCallOrder[1]!);
	});

	test('limits historical backfill, waits 30 seconds, and pauses for Save-Data', async () => {
		const database = await openDatabase('backfill');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		for (let index = 0; index < 30; index += 1) {
			const id = uuidv7();
			await database.meals.put(
				meal(id, uuidv7(), deviceId, {
					date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}` as `${number}-${number}-${number}`
				})
			);
		}
		let current = new Date(timestamp);
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const backfill = vi.spyOn(transport, 'backfill');
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment({ saveData: false }),
			now: () => current
		});
		await coordinator.syncNow();
		const first = backfill.mock.calls[0]?.[1];
		expect(first?.mutations.length).toBe(25);
		expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(
			HOUSEHOLD_BACKFILL_MAX_BYTES
		);
		await coordinator.syncNow();
		expect(backfill).toHaveBeenCalledTimes(1);
		current = new Date(current.getTime() + HOUSEHOLD_BACKFILL_INTERVAL_MS + 1);
		await coordinator.syncNow();
		expect(backfill).toHaveBeenCalledTimes(2);
		expect(backfill.mock.calls[1]?.[1].mutations.length).toBe(5);

		const saveDataCoordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment({ saveData: true }),
			now: () => new Date(current.getTime() + HOUSEHOLD_BACKFILL_INTERVAL_MS + 1)
		});
		await saveDataCoordinator.syncNow();
		expect(backfill).toHaveBeenCalledTimes(2);
	});

	test('includes the protocol envelope in the 256 KiB backfill limit', async () => {
		const database = await openDatabase('backfill-envelope');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		const sampleId = uuidv7();
		const sampleMutationId = uuidv7();
		const sample = meal(sampleId, sampleMutationId, deviceId, { notes: '' });
		const sampleMutation: HouseholdSyncMutation = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			mutationId: uuidv7(),
			originDeviceId: deviceId,
			entityKind: 'meal',
			entityId: sampleId,
			conflictGroups: ['schedule'],
			operation: 'upsert',
			occurredAt: timestamp,
			aggregate: sample
		};
		const targetMutationBytes = Math.floor((HOUSEHOLD_BACKFILL_MAX_BYTES - 64) / 2);
		const sampleBytes = new TextEncoder().encode(JSON.stringify(sampleMutation)).byteLength;
		const notes = 'x'.repeat(targetMutationBytes - sampleBytes);
		for (let index = 0; index < 2; index += 1) {
			await database.meals.put(meal(uuidv7(), uuidv7(), deviceId, { notes }));
		}
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const backfill = vi.spyOn(transport, 'backfill');
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment({ saveData: false })
		});

		await coordinator.syncNow();

		const request = backfill.mock.calls[0]?.[1];
		expect(request?.mutations).toHaveLength(1);
		expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThanOrEqual(
			HOUSEHOLD_BACKFILL_MAX_BYTES
		);
	});

	test('continues a started backfill after the 30-second interval', async () => {
		const database = await openDatabase('scheduled-backfill');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		for (let index = 0; index < 30; index += 1) {
			await database.meals.put(meal(uuidv7(), uuidv7(), deviceId));
		}
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const backfill = vi.spyOn(transport, 'backfill');
		let current = new Date(timestamp);
		const scheduled: { callback: () => void; delay: number }[] = [];
		const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay) => {
			if (typeof callback !== 'function') throw new TypeError('Expected a timer callback.');
			scheduled.push({ callback, delay: Number(delay ?? 0) });
			return scheduled.length as unknown as ReturnType<typeof setTimeout>;
		});
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment({ saveData: false }),
			now: () => current
		});

		try {
			coordinator.start();
			scheduled.shift()?.callback();
			await coordinator.syncNow();
			expect(backfill).toHaveBeenCalledTimes(1);
			expect(scheduled[0]?.delay).toBe(HOUSEHOLD_BACKFILL_INTERVAL_MS);
			current = new Date(current.getTime() + HOUSEHOLD_BACKFILL_INTERVAL_MS);
			scheduled.shift()?.callback();
			await coordinator.syncNow();
			expect(backfill).toHaveBeenCalledTimes(2);
		} finally {
			coordinator.stop();
			timer.mockRestore();
		}
	});

	test('detaches and quarantines only the revoked member auth slot', async () => {
		const database = await openDatabase('revoked');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		await seedProfile(database, {
			userId: 'user_bob',
			profileId: 'profile_bob',
			authSlotId: 'slot_bob',
			paid: true
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		await addLocalMealIntent(database, {
			mealId: uuidv7(),
			mutationId: uuidv7(),
			authSlotId: 'slot_alice',
			originDeviceId: deviceId,
			date: '2026-08-25'
		});
		await addLocalMealIntent(database, {
			mealId: uuidv7(),
			mutationId: uuidv7(),
			authSlotId: 'slot_bob',
			originDeviceId: deviceId,
			date: '2026-08-26'
		});
		const transport = new MemoryHouseholdServer().transport('user_alice');
		transport.pull = async () => {
			throw new SyncPermissionDenied({
				code: 'workos_membership_missing',
				message: 'revoked'
			});
		};
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment()
		});
		await expect(coordinator.syncNow()).resolves.toBe('blocked');
		expect(await database.memberships.get('membership_user_alice')).toMatchObject({
			status: 'detached',
			denialCode: 'workos_membership_missing'
		});
		const outbox = await database.outbox.toArray();
		expect(outbox.find(({ authSlotId }) => authSlotId === 'slot_alice')?.status).toBe(
			'quarantined'
		);
		expect(outbox.find(({ authSlotId }) => authSlotId === 'slot_bob')?.status).toBe('pending');
	});
});
