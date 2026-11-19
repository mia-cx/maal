import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { claimBackfillSlot } from '$lib/client/sync/backfill.js';
import {
	createHouseholdSyncCoordinator,
	createUserSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncEnvironment,
	type UserSyncTransport
} from '$lib/client/sync/index.js';
import { MealAggregateSchema } from '$lib/domain/meals/schema.js';
import { UnitUserEntrySchema } from '$lib/domain/taxonomy/schema.js';
import type { BackfillRequest } from '$lib/sync/contracts.js';
import type { HouseholdBackfillRequest } from '$lib/sync/household-contracts.js';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const authSlotId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const userId = 'user_alice';
const householdId = 'org_family';
const databases: MaalDatabase[] = [];

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(timestamp));
});

afterEach(async () => {
	vi.restoreAllMocks();
	for (const database of databases) {
		const name = database.name;
		database.close();
		await Dexie.delete(name);
	}
	databases.length = 0;
	vi.useRealTimers();
});

test('scheduled household backfill progresses before a large user backlog drains without exceeding the shared budget', async () => {
	const database = await openMaalDatabase(`backfill-budget-${crypto.randomUUID()}`);
	databases.push(database);
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
		householdId,
		workosUserId: userId,
		roleSlug: 'admin',
		permissions: ['recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
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
		householdId,
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
	const units = Array.from({ length: 150 }, (_, index) =>
		Schema.decodeUnknownSync(UnitUserEntrySchema)({
			id: uuidv7(),
			workosUserId: userId,
			canonicalLabel: `spoon ${index}`,
			baseUnitId: 'grams',
			toBaseFactor: 3.5,
			toBaseOffset: 0,
			adoptionStatus: 'accepted',
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {}
		})
	);
	await database.unitUserEntries.bulkPut(units);
	const mealId = uuidv7();
	await database.meals.put(
		Schema.decodeUnknownSync(MealAggregateSchema)({
			id: mealId,
			householdId,
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {},
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
			nutritionFacts: []
		})
	);

	const requests: {
		scope: 'user' | 'household';
		at: number;
		userRecordsBefore: number;
		entityIds: string[];
	}[] = [];
	const acceptedUserIds = new Set<string>();
	const sequences = { user: 0, household: 0 };
	const backfill = async <
		Checkpoint extends BackfillRequest['checkpoint'] | HouseholdBackfillRequest['checkpoint']
	>(
		_slot: string,
		request: {
			audience: { kind: 'user' | 'household' };
			checkpoint: Checkpoint;
			mutations: readonly { mutationId: string; entityId: string }[];
		}
	) => {
		const scope = request.audience.kind;
		requests.push({
			scope,
			at: Date.now() - Date.parse(timestamp),
			userRecordsBefore: acceptedUserIds.size,
			entityIds: request.mutations.map(({ entityId }) => entityId)
		});
		return {
			protocolVersion: 1 as const,
			receipts: request.mutations.map((mutation) => {
				if (scope === 'user') acceptedUserIds.add(mutation.entityId);
				return {
					mutationId: mutation.mutationId,
					status: 'accepted' as const,
					sequence: ++sequences[scope],
					resultingRevision: 1
				};
			}),
			committedThrough: sequences[scope],
			checkpoint: request.checkpoint
		};
	};
	const transport = {
		pull: async (_slot: string, request: { after: number }) => ({
			protocolVersion: 1 as const,
			changes: [],
			throughSequence: request.after,
			retainedFloor: 0,
			bootstrapGeneration: 1,
			hasMore: false
		}),
		push: async () => ({ protocolVersion: 1 as const, receipts: [], committedThrough: 0 }),
		bootstrap: async () => ({
			protocolVersion: 1 as const,
			aggregates: [],
			instructions: [],
			throughSequence: 0,
			retainedFloor: 0,
			bootstrapGeneration: 1,
			hasMore: false,
			nextEntityKey: null
		}),
		backfill
	} satisfies UserSyncTransport & HouseholdSyncTransport;
	const environment: UserSyncEnvironment = {
		isOnline: () => true,
		isVisible: () => true,
		isSaveDataEnabled: () => false,
		on: () => () => undefined
	};
	const user = createUserSyncCoordinator({
		database,
		authSlotId,
		workosUserId: userId,
		transport,
		environment
	});
	const household = createHouseholdSyncCoordinator({
		database,
		authSlotId,
		workosUserId: userId,
		householdId,
		transport,
		environment
	});

	// Drive coordinator callbacks in due-time order, leaving IndexedDB's real timers alone.
	const realSetTimeout = globalThis.setTimeout;
	const scheduled = new Map<number, { callback: () => void; dueAt: number }>();
	let nextTimerId = 0;
	vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay) => {
		if (typeof callback !== 'function') throw new TypeError('Expected a timer callback.');
		const id = ++nextTimerId;
		scheduled.set(id, { callback, dueAt: Date.now() + Number(delay ?? 0) });
		return id as unknown as ReturnType<typeof setTimeout>;
	});
	vi.spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
		scheduled.delete(Number(id));
	});
	const runNextCallback = async () => {
		const count = scheduled.size;
		const next = [...scheduled.entries()].toSorted(
			([, left], [, right]) => left.dueAt - right.dueAt
		)[0];
		expect(next, 'a coordinator must schedule its next run').toBeDefined();
		const [id, { callback, dueAt }] = next!;
		scheduled.delete(id);
		vi.setSystemTime(new Date(dueAt));
		callback();
		for (let attempt = 0; attempt < 1_000; attempt += 1) {
			await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
			const scopes = await database.syncScopes.toArray();
			if (scheduled.size === count && scopes.every(({ leaseOwner }) => leaseOwner === null)) {
				expect(
					scopes.every(({ state, lastErrorCode }) => state === 'idle' && lastErrorCode === null)
				).toBe(true);
				return;
			}
		}
		throw new Error('Scheduled sync callback did not finish and schedule its next run.');
	};

	try {
		user.start();
		await runNextCallback();
		expect(requests[0]).toMatchObject({ scope: 'user', at: 0 });
		expect(acceptedUserIds.size).toBe(25);
		vi.setSystemTime(new Date(Date.parse(timestamp) + 1));
		household.start();
		await runNextCallback();
		expect(requests).toHaveLength(1);

		for (let callback = 0; callback < 25; callback += 1) {
			if (
				acceptedUserIds.size === units.length &&
				requests.some(({ scope }) => scope === 'household')
			)
				break;
			await runNextCallback();
		}

		expect(acceptedUserIds.size).toBe(units.length);
		const householdRequests = requests.filter(({ scope }) => scope === 'household');
		expect(householdRequests).toHaveLength(1);
		expect(householdRequests[0]?.entityIds).toEqual([mealId]);
		for (let index = 1; index < requests.length; index += 1) {
			expect
				.soft(requests[index]!.at - requests[index - 1]!.at, JSON.stringify(requests))
				.toBeGreaterThanOrEqual(30_000);
		}
		expect(
			householdRequests[0]?.userRecordsBefore,
			JSON.stringify(
				requests.map(({ scope, at, userRecordsBefore }) => ({ scope, at, userRecordsBefore }))
			)
		).toBeLessThan(units.length);
	} finally {
		user.stop();
		household.stop();
	}
});

const at = (milliseconds: number) => new Date(Date.parse(timestamp) + milliseconds);

test('persists FIFO turns across tabs for three distinct scope keys', async () => {
	const environment = `backfill-budget-fifo-${crypto.randomUUID()}`;
	const database = await openMaalDatabase(environment);
	databases.push(database);
	const otherTab = await openMaalDatabase(environment);
	try {
		await expect(claimBackfillSlot(database, 'user', userId, at(0))).resolves.toBe(true);
		// The same ID in different scope kinds must have separate places in the queue.
		await expect(claimBackfillSlot(otherTab, 'household', userId, at(1))).resolves.toBe(false);
		await expect(claimBackfillSlot(database, 'household', householdId, at(2))).resolves.toBe(false);
		await expect(claimBackfillSlot(otherTab, 'user', userId, at(3))).resolves.toBe(false);

		await expect(claimBackfillSlot(database, 'user', userId, at(30_000))).resolves.toBe(false);
		await expect(claimBackfillSlot(otherTab, 'household', householdId, at(30_000))).resolves.toBe(
			false
		);
		await expect(claimBackfillSlot(database, 'household', userId, at(30_000))).resolves.toBe(true);
		await expect(claimBackfillSlot(otherTab, 'household', householdId, at(30_001))).resolves.toBe(
			false
		);

		await expect(claimBackfillSlot(database, 'user', userId, at(60_000))).resolves.toBe(false);
		await expect(claimBackfillSlot(otherTab, 'household', householdId, at(60_000))).resolves.toBe(
			true
		);
		await expect(claimBackfillSlot(database, 'user', userId, at(90_000))).resolves.toBe(true);
	} finally {
		otherTab.close();
	}
});

test('expires an inactive waiter exactly 60 seconds after its latest denied claim', async () => {
	const database = await openMaalDatabase(`backfill-budget-expiry-${crypto.randomUUID()}`);
	databases.push(database);
	await expect(claimBackfillSlot(database, 'user', userId, at(0))).resolves.toBe(true);
	await expect(claimBackfillSlot(database, 'household', householdId, at(1))).resolves.toBe(false);
	await expect(claimBackfillSlot(database, 'household', householdId, at(29_999))).resolves.toBe(
		false
	);
	await expect(claimBackfillSlot(database, 'user', userId, at(30_000))).resolves.toBe(false);
	// The household stays first beyond its original expiry because its denied retry refreshed it.
	await expect(claimBackfillSlot(database, 'user', userId, at(60_001))).resolves.toBe(false);
	await expect(claimBackfillSlot(database, 'user', userId, at(89_998))).resolves.toBe(false);
	await expect(claimBackfillSlot(database, 'user', userId, at(89_999))).resolves.toBe(true);
});
