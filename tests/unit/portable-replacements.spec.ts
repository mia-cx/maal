import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxRecord } from '$lib/client/local/records.js';
import { planRecipeAsMeal, saveMealCheckIn, updateMealSchedule } from '$lib/client/meals/index.js';
import { collectPortableArchive } from '$lib/client/portability/archive.js';
import {
	bulkResolutions,
	commitPortableImport,
	planPortableImport
} from '$lib/client/portability/import.js';
import {
	createRecipeFromEditor,
	deleteRecipe,
	restoreRecipe,
	type RecipeEditorPatch
} from '$lib/client/recipes/index.js';
import {
	applyHouseholdPullPage,
	createHouseholdSyncCoordinator,
	createUserSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncEnvironment,
	type UserSyncTransport
} from '$lib/client/sync/index.js';
import type { PortableArchive } from '$lib/domain/portability/schema.js';
import { MEAL_CONFLICT_GROUPS, MealCheckInSchema } from '$lib/domain/meals/schema.js';
import { RECIPE_CONFLICT_GROUPS } from '$lib/domain/recipes/schema.js';
import { pushUserSync, type UserSyncRepository } from '$lib/server/sync/index.js';
import { incomingWinsHistoricalConflict } from '$lib/server/sync/reconciliation.js';
import type { SyncMutation } from '$lib/sync/contracts.js';
import type { HouseholdSyncMutation } from '$lib/sync/household-contracts.js';
import { HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS } from '$lib/sync/household-entities.js';

const databases: MaalDatabase[] = [];
const at = (hour: number): `${string}Z` => `2026-08-21T${String(hour).padStart(2, '0')}:00:00.000Z`;
const importedAt = at(16);
const profileId = 'profile_alice';
const authSlotId = 'slot-alice';
const workosUserId = 'user_alice';
const householdId = 'org_family';
const deviceId = uuidv7();
const permissions = ['meals:read', 'meals:write', 'households:write'] as const;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(importedAt));
});

afterEach(async () => {
	for (const database of databases) {
		const name = database.name;
		database.close();
		await Dexie.delete(name);
	}
	databases.length = 0;
	vi.useRealTimers();
});

const openDatabase = async () => {
	const database = await openMaalDatabase(`portable-replacements-${crypto.randomUUID()}`);
	databases.push(database);
	await database.profiles.put({
		profileId,
		workosUserId,
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-US',
		timezone: 'UTC',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: at(8),
		authState: 'authenticated'
	});
	await database.authSlots.put({
		authSlotId,
		profileId,
		workosUserId,
		sessionState: 'authenticated',
		lastRefreshedAt: importedAt,
		lastVerifiedAt: importedAt,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.households.put({
		householdId,
		name: 'Family kitchen',
		locale: 'en-US',
		timezone: 'UTC',
		weekStartsOn: 1,
		defaultPlannedYield: 2,
		preferredDinnerTime: '18:00',
		createdByUserId: workosUserId,
		deletionState: 'active',
		localOnly: false,
		schemaVersion: 1,
		revision: 1,
		createdAt: at(8),
		updatedAt: at(8),
		deletedAt: null,
		conflictClocks: {}
	});
	await database.memberships.put({
		membershipId: 'membership_alice',
		householdId,
		workosUserId,
		roleSlug: 'admin',
		permissions,
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: at(8),
		lastVerifiedAt: importedAt,
		updatedAt: importedAt,
		detachedAt: null,
		denialCode: null,
		source: 'workos'
	});
	await database.meta.put({ key: 'deviceId', value: deviceId, updatedAt: at(8) });
	return database;
};

const recipeContext = (occurredAt = at(8)) => ({
	authSlotId,
	ownerUserId: workosUserId,
	originDeviceId: deviceId,
	occurredAt
});
const mealContext = (reporterUserId = workosUserId, occurredAt = at(9)) => ({
	authSlotId: reporterUserId === workosUserId ? authSlotId : 'slot-bob',
	householdId,
	reporterUserId,
	originDeviceId: deviceId,
	occurredAt
});
const patch = (title: string): RecipeEditorPatch => ({
	title,
	description: null,
	imageUrl: null,
	sourceUrl: null,
	sourceSiteName: null,
	sourceAuthorName: null,
	sourcePublisherName: null,
	sourceIsBasedOnUrl: null,
	prepTimeMinutes: null,
	cookTimeMinutes: 20,
	yield: 2,
	ingredients: [],
	instructions: [{ id: null, position: 1, text: 'Simmer.' }]
});
const environment = (saveData: boolean): UserSyncEnvironment => ({
	isOnline: () => true,
	isVisible: () => true,
	isSaveDataEnabled: () => saveData,
	on: () => () => undefined
});
const emptyPull = (throughSequence = 0) => ({
	protocolVersion: 1 as const,
	changes: [],
	throughSequence,
	retainedFloor: 0,
	bootstrapGeneration: 1,
	hasMore: false
});
const replace = async (database: MaalDatabase, archive: PortableArchive) => {
	const preview = await planPortableImport(database, archive, profileId);
	expect(preview.collisions.length).toBeGreaterThan(0);
	const plan = await planPortableImport(
		database,
		archive,
		profileId,
		bulkResolutions(preview.collisions, 'replace')
	);
	expect(plan.unresolvedCollisionIds).toEqual([]);
	await commitPortableImport(database, plan);
};

const householdTransport = () => {
	const pushed: HouseholdSyncMutation[] = [];
	const backfilled: HouseholdSyncMutation[] = [];
	let sequence = 0;
	const accept = (mutations: readonly HouseholdSyncMutation[]) => ({
		protocolVersion: 1 as const,
		receipts: mutations.map(({ mutationId }) => ({
			mutationId,
			status: 'accepted' as const,
			sequence: ++sequence,
			resultingRevision: 1
		})),
		committedThrough: sequence
	});
	const transport: HouseholdSyncTransport = {
		pull: async () => emptyPull(sequence),
		push: async (_slot, request) => {
			pushed.push(...request.mutations);
			return accept(request.mutations);
		},
		backfill: async (_slot, request) => {
			backfilled.push(...request.mutations);
			return { ...accept(request.mutations), checkpoint: request.checkpoint };
		},
		bootstrap: vi.fn()
	};
	return { transport, pushed, backfilled };
};
const householdCoordinator = (
	database: MaalDatabase,
	transport: HouseholdSyncTransport,
	saveData = true
) =>
	createHouseholdSyncCoordinator({
		database,
		authSlotId,
		workosUserId,
		householdId,
		transport,
		environment: environment(saveData),
		capabilityResolver: async () => ({
			enabled: true,
			stale: false,
			membershipActive: true,
			permissions
		})
	});

describe('portable replacements', () => {
	test('replaces stale intents with a deleted recipe mutation accepted by the server validator', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		await deleteRecipe(database, recipeContext(at(9)), recipe.id);
		const archive = await collectPortableArchive(database, profileId, { createdAt: at(10) });
		const archived = archive.deletedRecipes!.recipes[0]!;
		await database.outbox.clear();
		await restoreRecipe(database, recipeContext(at(12)), recipe.id);
		const stale = (await database.outbox.where('aggregateId').equals(recipe.id).first())!;
		expect(stale).toMatchObject({ status: 'pending', operation: 'upsert' });
		const superseded = [
			stale,
			{ ...stale, mutationId: uuidv7(), status: 'sending' as const },
			{ ...stale, mutationId: uuidv7(), status: 'quarantined' as const }
		];
		const unrelated = await createRecipeFromEditor(
			database,
			recipeContext(at(12)),
			patch('Unrelated stew')
		);
		const preserved: OutboxRecord[] = [
			{ ...stale, mutationId: uuidv7(), scopeId: 'user_bob' },
			{ ...stale, mutationId: uuidv7(), scopeKind: 'household', scopeId: workosUserId },
			{ ...stale, mutationId: uuidv7(), entityKind: 'unitUserEntry', status: 'quarantined' },
			{ ...stale, mutationId: uuidv7(), status: 'acknowledged' },
			{ ...stale, mutationId: uuidv7(), status: 'rejected' }
		];
		await database.outbox.bulkPut([...superseded, ...preserved]);
		await replace(database, archive);

		await expect(
			database.outbox.bulkGet(superseded.map(({ mutationId }) => mutationId))
		).resolves.toEqual(superseded.map(() => undefined));
		await expect(
			database.outbox.bulkGet(preserved.map(({ mutationId }) => mutationId))
		).resolves.toEqual(preserved);
		const replacement = (await database.outbox
			.where('aggregateId')
			.equals(recipe.id)
			.filter(
				({ status, scopeKind, scopeId, entityKind }) =>
					status === 'pending' &&
					scopeKind === 'user' &&
					scopeId === workosUserId &&
					entityKind === 'recipe'
			)
			.first())!;
		expect(replacement).toMatchObject({ operation: 'delete', occurredAt: importedAt, authSlotId });
		expect(superseded.map(({ mutationId }) => mutationId)).not.toContain(replacement.mutationId);
		await expect(database.recipes.get(recipe.id)).resolves.toMatchObject({
			updatedAt: archived.updatedAt,
			deletedAt: archived.deletedAt
		});

		const pushed: SyncMutation[] = [];
		let sequence = 0;
		const repository: UserSyncRepository = {
			readScopeState: async () => ({
				retainedFloor: 0,
				latestSequence: sequence,
				bootstrapGeneration: 1
			}),
			commit: vi.fn(async ({ mutation }) => ({
				mutationId: mutation.mutationId,
				status: 'accepted' as const,
				sequence: ++sequence,
				resultingRevision: 1
			})),
			pull: vi.fn(),
			bootstrap: vi.fn(),
			prune: vi.fn()
		};
		const transport: UserSyncTransport = {
			pull: async () => emptyPull(sequence),
			push: async (_slot, request) => {
				pushed.push(...request.mutations);
				return pushUserSync(repository, workosUserId, request);
			},
			bootstrap: vi.fn(),
			backfill: vi.fn()
		};
		const coordinator = createUserSyncCoordinator({
			database,
			authSlotId,
			workosUserId,
			transport,
			environment: environment(true),
			capabilityResolver: async () => ({ enabled: true, stale: false, householdId })
		});
		await expect(coordinator.syncNow()).resolves.toBe('complete');
		expect(pushed.map(({ entityId }) => entityId).toSorted()).toEqual(
			[recipe.id, unrelated.id].toSorted()
		);
		expect(pushed.find(({ entityId }) => entityId === recipe.id)).toMatchObject({
			mutationId: replacement.mutationId,
			operation: 'delete',
			conflictGroups: [...RECIPE_CONFLICT_GROUPS],
			aggregate: { deletedAt: archived.deletedAt, title: 'Soup' }
		});
		expect(repository.commit).toHaveBeenCalledTimes(2);
		await expect(database.outbox.get(replacement.mutationId)).resolves.toMatchObject({
			status: 'acknowledged'
		});
	});

	test('restores Bob locally without Alice intent, allowing unrelated sync and authoritative Bob pulls', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		const otherMeal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23'
		});
		const { checkIn: bob } = await saveMealCheckIn(database, mealContext('user_bob'), meal.id, {
			status: 'cooked',
			verdict: 'repeat',
			reason: 'Archived Bob'
		});
		const { checkIn: alice } = await saveMealCheckIn(database, mealContext(), otherMeal.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		const archive = await collectPortableArchive(database, profileId);
		await database.mealCheckIns.update(bob.id, { reason: 'Local Bob', updatedAt: at(12) });
		await database.outbox.clear();
		await updateMealSchedule(database, mealContext(workosUserId, at(12)), otherMeal.id, {
			date: '2026-08-24',
			time: '19:00',
			sortOrder: 0
		});
		// Skip already-uploaded aggregates so the run exercises check-in backfill as well as live push.
		for (const entityKind of Object.keys(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS)) {
			if (entityKind === 'meal_check_in') continue;
			await database.backfillCheckpoints.put({
				scopeKind: 'household',
				scopeId: householdId,
				entityKind,
				priorityBoundary: null,
				lastAggregateId: null,
				processedCount: 0,
				state: 'complete'
			});
		}
		const preview = await planPortableImport(database, archive, profileId);
		const collision = preview.collisions.find(({ store }) => store === 'mealCheckIns')!;
		await commitPortableImport(
			database,
			await planPortableImport(database, archive, profileId, {
				...bulkResolutions(preview.collisions, 'keep-local'),
				[collision.collisionId]: 'replace'
			})
		);
		await expect(database.mealCheckIns.get(bob.id)).resolves.toMatchObject({
			reporterUserId: 'user_bob',
			reason: 'Archived Bob',
			conflictClocks: { response: { occurredAt: bob.updatedAt } }
		});
		await expect(database.outbox.where('aggregateId').equals(bob.id).toArray()).resolves.toEqual(
			[]
		);

		const { transport, pushed, backfilled } = householdTransport();
		await expect(householdCoordinator(database, transport, false).syncNow()).resolves.toBe(
			'complete'
		);
		expect(pushed).toHaveLength(1);
		expect(pushed[0]).toMatchObject({
			entityKind: 'meal',
			entityId: otherMeal.id,
			conflictGroups: ['schedule']
		});
		expect(backfilled).toHaveLength(1);
		expect(backfilled[0]).toMatchObject({
			entityKind: 'meal_check_in',
			entityId: alice.id,
			aggregate: { reporterUserId: workosUserId }
		});
		expect([...pushed, ...backfilled].some(({ entityId }) => entityId === bob.id)).toBe(false);

		const clock = { occurredAt: at(13), mutationId: uuidv7(), originDeviceId: uuidv7() };
		await applyHouseholdPullPage(database, householdId, {
			...emptyPull(100),
			changes: [
				{
					sequence: 100,
					...clock,
					actorUserId: 'user_bob',
					entityKind: 'meal_check_in',
					entityId: bob.id,
					conflictGroups: ['response'],
					operation: 'upsert',
					resultingRevision: 2,
					receivedAt: at(13),
					tombstoneExpiresAt: null,
					aggregate: Schema.encodeSync(MealCheckInSchema)({
						...bob,
						reason: 'Authoritative Bob',
						updatedAt: at(13),
						revision: 2,
						conflictClocks: { response: clock }
					})
				}
			]
		});
		await expect(database.mealCheckIns.get(bob.id)).resolves.toMatchObject({
			reason: 'Authoritative Bob',
			revision: 2
		});
	});

	test('uses fresh per-row import clocks for replacements but archive clocks for new rows', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const newRecipe = await createRecipeFromEditor(database, recipeContext(at(9)), patch('Stew'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		const newMeal = await planRecipeAsMeal(
			database,
			mealContext(workosUserId, at(10)),
			newRecipe.id,
			{ date: '2026-08-23' }
		);
		const archive = await collectPortableArchive(database, profileId);
		await database.recipes.delete(newRecipe.id);
		await database.meals.delete(newMeal.id);
		await database.recipes.update(recipe.id, { title: 'Local soup', updatedAt: at(12) });
		await database.meals.update(meal.id, { title: 'Local meal', updatedAt: at(12) });
		await database.outbox.clear();
		await replace(database, archive);

		const historical = { occurredAt: at(12), originDeviceId: uuidv7(), mutationId: uuidv7() };
		const mutationIds: string[] = [];
		for (const [store, original, groups, replacement] of [
			['recipes', recipe, RECIPE_CONFLICT_GROUPS, true],
			['recipes', newRecipe, RECIPE_CONFLICT_GROUPS, false],
			['meals', meal, MEAL_CONFLICT_GROUPS, true],
			['meals', newMeal, MEAL_CONFLICT_GROUPS, false]
		] as const) {
			const restored = (await database[store].get(original.id))!;
			expect(restored.updatedAt).toBe(original.updatedAt);
			expect(restored.createdAt).toBe(original.createdAt);
			expect(Object.keys(restored.conflictClocks).toSorted()).toEqual([...groups].toSorted());
			const clocks = Object.values(restored.conflictClocks);
			const clock = clocks[0]!;
			mutationIds.push(clock.mutationId);
			expect(clocks).toEqual(
				groups.map(() => ({
					...clock,
					originDeviceId: deviceId,
					occurredAt: replacement ? importedAt : original.updatedAt
				}))
			);
			expect(incomingWinsHistoricalConflict(historical, clock)).toBe(replacement);
			const intents = await database.outbox.where('aggregateId').equals(original.id).toArray();
			expect(intents).toEqual(
				replacement
					? [
							expect.objectContaining({
								mutationId: clock.mutationId,
								occurredAt: importedAt,
								operation: 'upsert',
								status: 'pending'
							})
						]
					: []
			);
		}
		expect(new Set(mutationIds).size).toBe(4);
		const { transport, pushed } = householdTransport();
		await expect(householdCoordinator(database, transport).syncNow()).resolves.toBe('complete');
		expect(pushed).toHaveLength(1);
		expect(pushed[0]).toMatchObject({
			entityId: meal.id,
			operation: 'upsert',
			conflictGroups: [...MEAL_CONFLICT_GROUPS]
		});
		const replanned = await planPortableImport(database, archive, profileId);
		expect(replanned.collisions).toEqual([]);
	});
});
