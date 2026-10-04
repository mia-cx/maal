import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { projectAuthCallback } from '$lib/client/auth-slot-projection.js';
import type { AuthSlotId } from '$lib/auth-slots/index.js';
import {
	HOUSEHOLD_BACKFILL_INTERVAL_MS,
	HOUSEHOLD_BACKFILL_MAX_BYTES,
	HOUSEHOLD_BACKFILL_SINGLE_RECORD_MAX_BYTES,
	FOREGROUND_PULL_INTERVAL_MS,
	applyHouseholdBootstrap,
	applyHouseholdMutationReceipts,
	applyHouseholdPullPage,
	buildHouseholdSnapshotManifest,
	createHouseholdSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncEnvironment
} from '$lib/client/sync/index.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { MealAggregateSchema, type MealAggregate } from '$lib/domain/meals/schema.js';
import { deleteMeal, setMealStatus, updateMealSchedule } from '$lib/client/meals/commands.js';
import { SyncPermissionDenied, SyncTransportError } from '$lib/sync/contracts.js';
import type {
	HouseholdBackfillRequest,
	HouseholdPullRequest,
	HouseholdSyncChange,
	HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';
import { pushHouseholdSync, type HouseholdSyncRepository } from '$lib/server/sync/index.js';

const householdId = 'org_family';
const householdScope = { authSlotId: 'slot_alice', householdId };
const timestamp = '2026-08-21T12:00:00.000Z' as const;
const databases: MaalDatabase[] = [];

beforeEach(() => {
	// Pin subscription validity without intercepting Dexie or coordinator timers.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(timestamp));
});

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
	vi.useRealTimers();
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

	test.each([
		[
			'unknown conflict group',
			(mutation: HouseholdSyncMutation) => ({
				...mutation,
				conflictGroups: ['surprise'] as [string, ...string[]]
			})
		],
		[
			'operation/deletion mismatch',
			(mutation: HouseholdSyncMutation) => ({
				...mutation,
				operation: 'delete' as const
			})
		]
	])('rejects an %s before the first household repository write', async (_label, invalidate) => {
		const commit = vi.fn();
		const repository = {
			readScopeState: async () => ({ retainedFloor: 0, latestSequence: 0, bootstrapGeneration: 1 }),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			commit,
			prune: vi.fn()
		} satisfies HouseholdSyncRepository;
		const originDeviceId = uuidv7();
		const aggregate = meal(uuidv7(), uuidv7(), originDeviceId);
		const mutation: HouseholdSyncMutation = {
			schemaVersion: 1,
			mutationId: uuidv7(),
			originDeviceId,
			entityKind: 'meal',
			entityId: aggregate.id,
			conflictGroups: ['schedule'],
			operation: 'upsert',
			occurredAt: timestamp,
			aggregate
		};

		await expect(
			pushHouseholdSync(repository, householdId, 'user_alice', {
				protocolVersion: 1,
				deviceId: originDeviceId,
				audience: { kind: 'household', id: householdId },
				baseCursor: null,
				mutations: [mutation, invalidate({ ...mutation, mutationId: uuidv7() })]
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
	test.each(['mutation', 'capability', 'online', 'visible'] as const)(
		'lets a %s notification preempt the foreground poll',
		async (trigger) => {
			vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
			const database = await openDatabase('scheduling');
			await seedProfile(database, {
				userId: 'user_alice',
				profileId: 'profile_alice',
				authSlotId: 'slot_alice',
				paid: true
			});
			const transport = new MemoryHouseholdServer().transport('user_alice');
			const pull = vi.spyOn(transport, 'pull');
			const listeners = new Map<string, () => void>();
			const coordinator = createHouseholdSyncCoordinator({
				database,
				authSlotId: 'slot_alice',
				workosUserId: 'user_alice',
				householdId,
				transport,
				environment: {
					...environment(),
					on: (event, listener) => {
						listeners.set(event, listener);
						return () => listeners.delete(event);
					}
				}
			});
			coordinator.start();
			try {
				const waitForPulls = (count: number) =>
					vi.waitFor(async () => {
						expect(pull).toHaveBeenCalledTimes(count);
						expect(
							(await database.syncScopes.get(['household', householdId]))?.leaseOwner
						).toBeNull();
					});
				await vi.advanceTimersByTimeAsync(0);
				await waitForPulls(1);
				if (trigger === 'mutation') coordinator.notifyLocalMutation();
				else if (trigger === 'capability') coordinator.resumeAfterCapabilityRefresh();
				else listeners.get(trigger)!();
				await vi.advanceTimersByTimeAsync(trigger === 'mutation' ? 250 : 0);
				await waitForPulls(2);
				await vi.advanceTimersByTimeAsync(FOREGROUND_PULL_INTERVAL_MS);
				await waitForPulls(3);
			} finally {
				coordinator.stop();
			}
		}
	);

	test('hydrates each aggregate once while draining a multi-batch backlog', async () => {
		const database = await openDatabase('bounded-hydration');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const originDeviceId = String((await database.meta.get('deviceId'))!.value);
		for (let index = 0; index < 120; index += 1) {
			await addLocalMealIntent(database, {
				mealId: uuidv7(),
				mutationId: uuidv7(),
				authSlotId: 'slot_alice',
				originDeviceId,
				date: '2026-08-25'
			});
		}
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const push = vi.spyOn(transport, 'push');
		// Empty pulls isolate interactive hydration from application of server changes.
		transport.pull = async (_slot, request) => ({
			protocolVersion: 1,
			changes: [],
			throughSequence: request.after,
			retainedFloor: 0,
			bootstrapGeneration: 1,
			hasMore: false
		});
		const table = vi.spyOn(database, 'table');
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment()
		});
		await expect(coordinator.syncNow()).resolves.toBe('complete');
		expect(push.mock.calls.map(([, request]) => request.mutations.length)).toEqual([50, 50, 20]);
		expect(table.mock.calls.filter(([store]) => store === 'meals')).toHaveLength(120);
		expect(
			await database.outbox
				.where('[scopeKind+scopeId+status]')
				.equals(['household', householdId, 'pending'])
				.count()
		).toBe(0);
	});

	test('applies entity-key bootstrap pages whose commit sequences are not monotonic', async () => {
		const database = await openDatabase('bootstrap-key-order');
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		const [firstId, secondId] = [uuidv7(), uuidv7()].toSorted();
		const first = meal(firstId, uuidv7(), deviceId);
		const second = meal(secondId, uuidv7(), deviceId);
		await applyHouseholdBootstrap(database, householdScope, {
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

	test('stops an active cached capability at validUntil without content traffic', async () => {
		const database = await openDatabase('expired-capability');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		await database.billingCapabilities.update(householdId, { validUntil: timestamp });
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const requests = [
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
			environment: environment(),
			now: () => new Date(timestamp)
		});

		await expect(coordinator.syncNow()).resolves.toBe('disabled');
		expect(requests.map(({ mock }) => mock.calls.length)).toEqual([0, 0, 0, 0]);
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

	test('keeps a newer pending meal until every mutation masking the remote meal is rejected', async () => {
		const database = await openDatabase('multiple-rejected-masked-pull');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: false
		});
		const mealId = uuidv7();
		const firstMutationId = uuidv7();
		const secondMutationId = uuidv7();
		const deviceId = uuidv7();
		const local = meal(mealId, secondMutationId, deviceId, { date: '2026-08-24' });
		const remote = meal(mealId, uuidv7(), uuidv7(), { date: '2026-08-23', revision: 2 });
		await database.meals.put(local);
		await database.outbox.bulkPut(
			[firstMutationId, secondMutationId].map((mutationId) => ({
				mutationId,
				authSlotId: 'slot_alice',
				scopeKind: 'household' as const,
				scopeId: householdId,
				status: 'pending' as const,
				occurredAt: timestamp,
				aggregateId: mealId,
				entityKind: 'meal',
				conflictGroup: 'schedule',
				operation: 'upsert' as const,
				originDeviceId: deviceId,
				payload: {},
				nextAttemptAt: timestamp,
				attempts: 0
			}))
		);
		await applyHouseholdPullPage(database, householdScope, {
			protocolVersion: 1,
			changes: [
				{
					sequence: 1,
					mutationId: uuidv7(),
					originDeviceId: uuidv7(),
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
		});

		const rejected = (mutationId: string) => ({
			mutationId,
			status: 'rejected' as const,
			sequence: null,
			resultingRevision: null,
			errorCode: 'historical_loser'
		});
		await applyHouseholdMutationReceipts(database, householdId, [rejected(secondMutationId)]);
		await expect(database.meals.get(mealId)).resolves.toEqual(local);

		await applyHouseholdMutationReceipts(database, householdId, [rejected(firstMutationId)]);
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

	test('does not backfill an aggregate a quarantined member edit touched', async () => {
		const database = await openDatabase('quarantined-backfill');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		const quarantinedMeal = meal(uuidv7(), uuidv7(), deviceId);
		const cleanMeal = meal(uuidv7(), uuidv7(), deviceId);
		await database.meals.bulkPut([quarantinedMeal, cleanMeal]);
		// A revoked member's edit quarantined on this device: backfilling the shared meal under
		// Alice's credentials would upload Bob's intent.
		await database.outbox.add({
			mutationId: uuidv7(),
			authSlotId: 'slot_bob',
			scopeKind: 'household',
			scopeId: householdId,
			status: 'quarantined',
			occurredAt: timestamp,
			aggregateId: quarantinedMeal.id,
			entityKind: 'meal',
			conflictGroup: 'schedule',
			operation: 'upsert',
			originDeviceId: deviceId,
			payload: null,
			nextAttemptAt: timestamp,
			attempts: 0
		});
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

		await expect(coordinator.syncNow()).resolves.toBe('complete');

		expect(backfill).toHaveBeenCalledTimes(1);
		expect(backfill.mock.calls[0]?.[1].mutations.map(({ entityId }) => entityId)).toEqual([
			cleanMeal.id
		]);
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

	test('persists an oversized backfill result and uploads the later meal', async () => {
		const database = await openDatabase('oversized-backfill');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const deviceId = String((await database.meta.get('deviceId'))!.value);
		const oversizedId = uuidv7();
		const laterId = uuidv7();
		await database.meals.bulkPut([
			meal(oversizedId, uuidv7(), deviceId, {
				date: '2026-08-22',
				notes: 'x'.repeat(HOUSEHOLD_BACKFILL_SINGLE_RECORD_MAX_BYTES + 1_024)
			}),
			meal(laterId, uuidv7(), deviceId, { date: '2026-08-23' })
		]);
		const transport = new MemoryHouseholdServer().transport('user_alice');
		const backfill = vi.spyOn(transport, 'backfill');
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
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
			database.backfillCheckpoints.get(['household', householdId, 'meal'])
		).resolves.toMatchObject({ lastAggregateId: laterId, processedCount: 2 });
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

	test('pushes a schedule edit and a later delete as an upsert then the delete', async () => {
		const database = await openDatabase('edit-delete');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: true
		});
		const originDeviceId = String((await database.meta.get('deviceId'))!.value);
		const mealId = uuidv7();
		await addLocalMealIntent(database, {
			mealId,
			mutationId: uuidv7(),
			authSlotId: 'slot_alice',
			originDeviceId,
			date: '2026-08-25'
		});
		await deleteMeal(
			database,
			{
				authSlotId: 'slot_alice',
				householdId,
				reporterUserId: 'user_alice',
				originDeviceId,
				occurredAt: '2026-08-21T12:01:00.000Z'
			},
			mealId
		);
		let sequence = 0;
		const repository: HouseholdSyncRepository = {
			readScopeState: async () => ({
				retainedFloor: 0,
				latestSequence: sequence,
				bootstrapGeneration: 1
			}),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			commit: async ({ mutation }) => ({
				mutationId: mutation.mutationId,
				status: 'accepted',
				sequence: ++sequence,
				resultingRevision: 1
			}),
			prune: vi.fn()
		};
		const pushes: HouseholdSyncMutation[][] = [];
		const transport: HouseholdSyncTransport = {
			...new MemoryHouseholdServer().transport('user_alice'),
			push: async (_slot, request) => {
				pushes.push([...request.mutations]);
				try {
					return await pushHouseholdSync(repository, householdId, 'user_alice', request);
				} catch (error) {
					throw new SyncTransportError({
						code: (error as { code?: string }).code ?? 'unknown',
						message: 'The sync request was rejected.',
						retryable: false
					});
				}
			}
		};
		const coordinator = createHouseholdSyncCoordinator({
			database,
			authSlotId: 'slot_alice',
			workosUserId: 'user_alice',
			householdId,
			transport,
			environment: environment()
		});
		vi.setSystemTime(new Date('2026-08-21T12:05:00.000Z'));

		await expect(coordinator.syncNow()).resolves.toBe('complete');

		expect(
			pushes
				.flat()
				.map(({ operation, conflictGroups, aggregate }) => [
					operation,
					conflictGroups,
					(aggregate as { deletedAt: string | null }).deletedAt
				])
		).toEqual([
			['upsert', ['schedule'], null],
			['delete', ['deletion'], '2026-08-21T12:01:00.000Z']
		]);
		expect(
			(await database.outbox.toArray()).map(({ operation, status }) => [operation, status])
		).toEqual([['delete', 'acknowledged']]);
	});

	test('keeps a pending local hard delete when a pull brings the meal back', async () => {
		const database = await openDatabase('hard-delete');
		await seedProfile(database, {
			userId: 'user_alice',
			profileId: 'profile_alice',
			authSlotId: 'slot_alice',
			paid: false
		});
		const originDeviceId = String((await database.meta.get('deviceId'))!.value);
		const remoteMutationId = uuidv7();
		const remote = meal(uuidv7(), remoteMutationId, uuidv7());
		const mutationId = uuidv7();
		await database.outbox.add({
			mutationId,
			authSlotId: 'slot_alice',
			scopeKind: 'household',
			scopeId: householdId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: remote.id,
			entityKind: 'meal',
			conflictGroup: 'deletion',
			operation: 'delete',
			originDeviceId,
			payload: null,
			nextAttemptAt: timestamp,
			attempts: 0,
			backfillConflictGroups: ['deletion'],
			snapshot: { ...remote, deletedAt: timestamp }
		});

		await applyHouseholdPullPage(database, householdScope, {
			protocolVersion: 1,
			changes: [
				{
					sequence: 1,
					mutationId: remoteMutationId,
					originDeviceId: uuidv7(),
					actorUserId: 'user_bob',
					entityKind: 'meal',
					entityId: remote.id,
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
		});

		expect(await database.meals.get(remote.id)).toBeUndefined();
		expect(await database.outbox.get(mutationId)).toMatchObject({ status: 'pending' });
	});

	test.each([
		['pull', false, false],
		['bootstrap', false, false],
		['bootstrap absence', false, false],
		['receipt', false, false],
		['pull', true, false],
		['pull', false, true]
	] as const)(
		"preserves a signed-out profile's edit and deletion through %s, rebind, and push (later edits: %s, purged: %s)",
		async (replacement, laterEdits, purged) => {
			const database = await openDatabase('signed-out');
			await seedProfile(database, {
				userId: 'user_alice',
				profileId: 'profile_alice',
				authSlotId: 'slot_alice',
				paid: true
			});
			const bobSlot = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as AuthSlotId;
			const authenticate = () =>
				projectAuthCallback(
					database,
					{
						authSlotId: bobSlot,
						authStatus: 'authenticated'
					},
					{
						now: timestamp,
						fetcher: async () =>
							Response.json({
								schemaVersion: 1,
								authSlotId: bobSlot,
								status: 'authenticated',
								workosUserId: 'user_bob',
								email: 'bob@example.test',
								firstName: 'Bob',
								lastName: null,
								profilePictureUrl: null,
								verifiedAt: timestamp,
								households: []
							})
					}
				);
			const { profileId } = await authenticate();
			if (!profileId) throw new Error('Expected an authenticated local profile.');
			await seedProfile(database, {
				userId: 'user_bob',
				profileId,
				authSlotId: bobSlot,
				paid: true
			});
			await database.authSlots.delete(bobSlot);
			await database.profiles.update(profileId, { authState: 'signedOut' });
			const originDeviceId = String((await database.meta.get('deviceId'))!.value);
			const context = {
				authSlotId: `signed-out:${profileId}`,
				householdId,
				reporterUserId: 'user_bob',
				originDeviceId,
				occurredAt: timestamp
			};
			const mealId = uuidv7();
			const deletedId = uuidv7();
			await database.meals.bulkPut([
				meal(mealId, uuidv7(), originDeviceId),
				meal(deletedId, uuidv7(), originDeviceId)
			]);
			let local = await updateMealSchedule(database, context, mealId, {
				date: '2026-08-25',
				time: '19:00',
				sortOrder: 1
			});
			if (purged) await database.billingCapabilities.delete(householdId);
			const deleted = await deleteMeal(database, context, deletedId);
			expect('purgedAt' in deleted).toBe(purged);
			const deferred = await database.outbox.toArray();
			expect(deferred.every((row) => row.snapshot === undefined)).toBe(true);
			const remote = [mealId, deletedId].map((id, index): HouseholdSyncChange => {
				const mutationId = uuidv7();
				return {
					sequence: index + 1,
					mutationId,
					originDeviceId: uuidv7(),
					actorUserId: 'user_carol',
					entityKind: 'meal',
					entityId: id,
					conflictGroups: ['header'],
					operation: 'upsert',
					resultingRevision: 2,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate: meal(id, mutationId, uuidv7(), { title: 'Remote soup' }),
					tombstoneExpiresAt: null
				};
			});
			const page = {
				protocolVersion: 1 as const,
				throughSequence: 1,
				retainedFloor: 0,
				bootstrapGeneration: 1,
				hasMore: false
			};
			if (replacement === 'pull') {
				// Repeated changes for one key must not replace its saved intent with the first remote value.
				await applyHouseholdPullPage(database, householdScope, {
					...page,
					throughSequence: 3,
					changes: [...remote, { ...remote[0]!, sequence: 3 }]
				});
			} else if (replacement === 'receipt') {
				const rows = remote.map((change) => ({
					...deferred.find((row) => row.aggregateId === change.entityId)!,
					mutationId: uuidv7(),
					authSlotId: 'slot_alice',
					authoritativeSnapshot: change.aggregate
				}));
				await database.outbox.bulkAdd(rows);
				await applyHouseholdMutationReceipts(
					database,
					householdId,
					rows.map(({ mutationId }) => ({
						mutationId,
						status: 'rejected',
						sequence: null,
						resultingRevision: null,
						errorCode: 'historical_loser'
					}))
				);
			} else {
				await applyHouseholdBootstrap(database, householdScope, {
					...page,
					throughSequence: 2,
					aggregates: replacement === 'bootstrap' ? remote : [],
					instructions:
						replacement === 'bootstrap absence'
							? remote.map(({ entityKind, entityId }) => ({
									entityKind,
									entityId,
									action: 'delete_acknowledged_absence' as const
								}))
							: [],
					nextEntityKey: null
				});
			}
			for (const id of [mealId, deletedId]) {
				if (replacement === 'bootstrap absence')
					expect(await database.meals.get(id)).toBeUndefined();
				else expect(await database.meals.get(id)).toMatchObject({ title: 'Remote soup' });
			}
			for (const row of deferred) {
				expect(await database.outbox.get(row.mutationId)).toMatchObject({
					authSlotId: context.authSlotId,
					status: 'pending',
					snapshot: row.aggregateId === mealId ? local : deleted
				});
			}
			if (laterEdits) {
				local = await setMealStatus(
					database,
					{ ...context, occurredAt: '2026-08-21T12:01:00.000Z' },
					mealId,
					'cooked'
				);
				expect(local.date).toBe('2026-08-25');
				// Alice has no saved snapshot yet, but must not erase Bob's newest restored intent.
				await updateMealSchedule(
					database,
					{
						...context,
						authSlotId: 'slot_alice',
						reporterUserId: 'user_alice',
						occurredAt: '2026-08-21T12:01:10.000Z'
					},
					mealId,
					{ date: '2026-08-27', time: '21:00', sortOrder: 3 }
				);
				local = await setMealStatus(
					database,
					{ ...context, occurredAt: '2026-08-21T12:01:20.000Z' },
					mealId,
					'cooked'
				);
				expect(local.date).toBe('2026-08-25');
				await applyHouseholdPullPage(database, householdScope, {
					...page,
					throughSequence: 4,
					changes: [{ ...remote[0]!, sequence: 4 }]
				});
				await updateMealSchedule(
					database,
					{
						...context,
						authSlotId: 'slot_alice',
						reporterUserId: 'user_alice',
						occurredAt: '2026-08-21T12:01:30.000Z'
					},
					mealId,
					{ date: '2026-08-27', time: '21:00', sortOrder: 3 }
				);
			}
			await authenticate();
			if (purged)
				await seedProfile(database, {
					userId: 'user_bob',
					profileId,
					authSlotId: bobSlot,
					paid: true
				});
			for (const row of deferred)
				expect((await database.outbox.get(row.mutationId))?.authSlotId).toBe(bobSlot);
			if (laterEdits) {
				local = await updateMealSchedule(
					database,
					{ ...context, authSlotId: bobSlot, occurredAt: '2026-08-21T12:02:00.000Z' },
					mealId,
					{ date: '2026-08-26', time: '20:00', sortOrder: 2 }
				);
				expect(local.status).toBe('cooked');
				local = await setMealStatus(
					database,
					{ ...context, authSlotId: bobSlot, occurredAt: '2026-08-21T12:03:00.000Z' },
					mealId,
					'skipped'
				);
				expect(local.date).toBe('2026-08-26');
				vi.setSystemTime(new Date('2026-08-21T12:05:00.000Z'));
			}
			let sequence = 4;
			const repository: HouseholdSyncRepository = {
				readScopeState: async () => ({
					retainedFloor: 0,
					latestSequence: sequence,
					bootstrapGeneration: 1
				}),
				pull: vi.fn(),
				bootstrap: vi.fn(),
				prune: vi.fn(),
				commit: async ({ mutation }) => ({
					mutationId: mutation.mutationId,
					status: 'accepted',
					sequence: ++sequence,
					resultingRevision: 1
				})
			};
			const transport = new MemoryHouseholdServer().transport('user_bob');
			transport.pull = async (_slot, request) => ({
				...page,
				changes: [],
				throughSequence: request.after
			});
			const push = vi.fn<HouseholdSyncTransport['push']>(async (_slot, request) =>
				pushHouseholdSync(repository, householdId, 'user_bob', request)
			);
			transport.push = push;
			const coordinator = createHouseholdSyncCoordinator({
				database,
				authSlotId: bobSlot,
				workosUserId: 'user_bob',
				householdId,
				transport,
				environment: environment()
			});
			await expect(coordinator.syncNow()).resolves.toBe('complete');
			expect(push).toHaveBeenCalledTimes(1);
			const sent = push.mock.calls[0]![1].mutations;
			expect(
				sent
					.filter(({ entityId }) => entityId === mealId)
					.map(({ operation, aggregate }) => ({ operation, aggregate }))
			).toEqual(
				Array.from({ length: laterEdits ? 2 : 1 }, () => ({
					operation: 'upsert',
					aggregate: local
				}))
			);
			expect(sent.find(({ entityId }) => entityId === deletedId)).toMatchObject({
				mutationId: deferred.find(({ aggregateId }) => aggregateId === deletedId)!.mutationId,
				operation: 'delete',
				aggregate: deleted
			});
			if (!laterEdits)
				expect(sent.find(({ entityId }) => entityId === mealId)?.mutationId).toBe(
					deferred.find(({ aggregateId }) => aggregateId === mealId)!.mutationId
				);
			const remaining = (await database.outbox.toArray()).filter(
				({ authSlotId }) => authSlotId === bobSlot
			);
			expect(remaining.map(({ aggregateId, status }) => [aggregateId, status])).toEqual(
				expect.arrayContaining([
					[mealId, 'acknowledged'],
					[deletedId, 'acknowledged']
				])
			);
			expect(remaining.every((row) => row.snapshot === undefined)).toBe(true);
			if (laterEdits) {
				const aliceCoordinator = createHouseholdSyncCoordinator({
					database,
					authSlotId: 'slot_alice',
					workosUserId: 'user_alice',
					householdId,
					transport,
					environment: environment()
				});
				await expect(aliceCoordinator.syncNow()).resolves.toBe('complete');
				expect(push.mock.calls[1]?.[1].mutations).toHaveLength(1);
				expect(push.mock.calls[1]?.[1].mutations[0]).toMatchObject({
					operation: 'upsert',
					conflictGroups: ['schedule'],
					aggregate: { date: '2026-08-27' }
				});
			}
			expect(
				(await database.outbox.toArray()).some(
					({ status }) => status === 'pending' || status === 'sending'
				)
			).toBe(false);
		}
	);
	test('counts a bootstrapped meal as server-acknowledged under the applying auth slot', async () => {
		const database = await openDatabase('bootstrap-ack');
		const mutationId = uuidv7();
		const remote = meal(uuidv7(), mutationId, uuidv7());

		await applyHouseholdBootstrap(database, householdScope, {
			protocolVersion: 1,
			aggregates: [
				{
					sequence: 4,
					mutationId,
					originDeviceId: uuidv7(),
					actorUserId: 'user_bob',
					entityKind: 'meal',
					entityId: remote.id,
					conflictGroups: ['schedule'],
					operation: 'upsert',
					resultingRevision: 1,
					occurredAt: timestamp,
					receivedAt: timestamp,
					aggregate: remote,
					tombstoneExpiresAt: null
				}
			],
			instructions: [],
			throughSequence: 4,
			retainedFloor: 0,
			bootstrapGeneration: 1,
			hasMore: false,
			nextEntityKey: null
		});

		expect(await buildHouseholdSnapshotManifest(database, householdId)).toEqual([
			expect.objectContaining({ entityId: remote.id, previousServerAck: true })
		]);
		expect(await database.outbox.get(mutationId)).toMatchObject({
			authSlotId: 'slot_alice',
			status: 'acknowledged',
			acknowledgedSequence: 4
		});
	});
});
