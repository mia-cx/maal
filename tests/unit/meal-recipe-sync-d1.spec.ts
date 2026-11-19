import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import type { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	listHouseholdMeals,
	planRecipeAsMeal,
	saveMealCheckIn,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { commitImportedRecipeCandidate } from '$lib/client/recipes/index.js';
import {
	createHouseholdSyncCoordinator,
	type HouseholdSyncTransport
} from '$lib/client/sync/index.js';
import { readUnseenRejections } from '$lib/client/sync/rejections.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	MEAL_CONFLICT_GROUPS,
	isRecipeFollowingMeal,
	type StoredMeal
} from '$lib/domain/meals/schema.js';
import type { RecipeAggregate } from '$lib/domain/recipes/schema.js';
import { candidateFromToolRecipe } from '$lib/server/mcp/builders.js';
import {
	D1HouseholdSyncRepository,
	D1UserSyncRepository,
	backfillHouseholdSync,
	bootstrapHouseholdSync,
	pullHouseholdSync,
	pushHouseholdSync
} from '$lib/server/sync/index.js';

import { createMcpTestDatabase } from './mcp-test-helpers.js';

const householdId = 'org_family';
const alice = { userId: 'user_alice', profileId: 'profile_alice', slot: 'slot_alice' };
const bob = { userId: 'user_bob', profileId: 'profile_bob', slot: 'slot_bob' };
const joinedAt = '2026-08-20T12:00:00.000Z';
const permissions = ['meals:read', 'meals:write', 'recipes:read', 'recipes:write'] as const;

let miniflare: Miniflare;
let d1: D1Database;
const devices: MaalDatabase[] = [];

beforeEach(async () => {
	({ miniflare, database: d1 } = await createMcpTestDatabase());
	await d1
		.prepare('INSERT INTO users (workos_user_id) VALUES (?), (?)')
		.bind(alice.userId, bob.userId)
		.run();
	await d1
		.prepare('INSERT INTO households (household_id, created_by_user_id) VALUES (?, ?)')
		.bind(householdId, alice.userId)
		.run();
	for (const member of [alice, bob]) {
		await d1
			.prepare(
				`INSERT INTO household_memberships
				 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
				  workos_created_at, last_verified_at)
				 VALUES (?, ?, ?, 'member', ?, 'active', ?, ?)`
			)
			.bind(
				`membership_${member.userId}`,
				householdId,
				member.userId,
				JSON.stringify(permissions),
				joinedAt,
				joinedAt
			)
			.run();
	}
});

afterEach(async () => {
	for (const device of devices.splice(0)) {
		device.close();
		await Dexie.delete(device.name);
	}
	await miniflare.dispose();
});

/** One member's device, signed in and paid, with a coordinator talking to the real D1 services. */
const openDevice = async (member: typeof alice) => {
	const database = await openMaalDatabase(`meal-recipe-sync-${crypto.randomUUID()}`);
	devices.push(database);
	await database.profiles.put({
		profileId: member.profileId,
		workosUserId: member.userId,
		displayName: member.userId,
		email: null,
		profilePictureUrl: null,
		locale: 'en-US',
		timezone: null,
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: joinedAt,
		authState: 'authenticated'
	});
	await database.uiState.put({ key: 'activeProfileId', value: member.profileId });
	await database.authSlots.put({
		authSlotId: member.slot,
		profileId: member.profileId,
		workosUserId: member.userId,
		sessionState: 'authenticated',
		lastRefreshedAt: joinedAt,
		lastVerifiedAt: joinedAt,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.memberships.put({
		membershipId: `membership_${member.userId}`,
		householdId,
		workosUserId: member.userId,
		roleSlug: 'member',
		permissions: [...permissions],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: joinedAt,
		lastVerifiedAt: joinedAt,
		updatedAt: joinedAt,
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
	await database.billingCapabilities.put({
		householdId,
		state: 'enabled',
		stripeStatus: 'active',
		subscriberUserId: alice.userId,
		stripePriceId: 'price_test',
		currentPeriodEnd: '2099-01-01T00:00:00.000Z',
		interruptionStartedAt: null,
		graceUntil: null,
		validUntil: '2099-01-01T00:00:00.000Z',
		cancelAtPeriodEnd: false,
		stale: false,
		source: 'stripe-d1'
	});
	const repository = new D1HouseholdSyncRepository(d1);
	const transport: HouseholdSyncTransport = {
		pull: async (_slot, request) => pullHouseholdSync(repository, householdId, request),
		push: async (_slot, request) =>
			pushHouseholdSync(repository, householdId, member.userId, request),
		bootstrap: async (_slot, request) => bootstrapHouseholdSync(repository, householdId, request),
		backfill: async (_slot, request) =>
			backfillHouseholdSync(repository, householdId, member.userId, request)
	};
	const coordinator = createHouseholdSyncCoordinator({
		database,
		authSlotId: member.slot,
		workosUserId: member.userId,
		householdId,
		transport,
		environment: {
			isOnline: () => true,
			isVisible: () => true,
			isSaveDataEnabled: () => false,
			on: () => () => undefined
		}
	});
	const context: MealCommandContext = {
		authSlotId: member.slot,
		householdId,
		reporterUserId: member.userId,
		originDeviceId: (await database.meta.get('deviceId'))!.value as string
	};
	return { database, context, sync: () => coordinator.syncNow() };
};

/** Commits a recipe to D1 the way its owner's user sync would. */
const commitRecipe = async (recipe: RecipeAggregate, groups: readonly string[]) => {
	const receipt = await new D1UserSyncRepository(d1).commit({
		actorUserId: recipe.ownerUserId,
		deviceId: uuidv7(),
		mutation: {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			mutationId: uuidv7(),
			originDeviceId: uuidv7(),
			entityKind: 'recipe',
			entityId: recipe.id,
			conflictGroups: [...groups] as [string, ...string[]],
			operation: 'upsert',
			occurredAt: new Date().toISOString() as `${string}Z`,
			aggregate: recipe
		},
		mode: 'live',
		receivedAt: new Date().toISOString()
	});
	expect(receipt.status).toBe('accepted');
};

/** Alice saves a recipe on her device and her user sync uploads it. */
const aliceSavesRecipe = async (device: Awaited<ReturnType<typeof openDevice>>) => {
	const recipe = await commitImportedRecipeCandidate(
		device.database,
		{
			authSlotId: alice.slot,
			ownerUserId: alice.userId,
			originDeviceId: device.context.originDeviceId
		},
		candidateFromToolRecipe({
			title: 'Sunday soup',
			ingredients: ['800 g tomatoes'],
			instructions: ['Simmer for 20 minutes.']
		})
	);
	await commitRecipe(recipe, ['header', 'ingredients', 'instructions']);
	return recipe;
};

const titles = async (database: MaalDatabase) =>
	new Map((await listHouseholdMeals(database, householdId)).map(({ id, title }) => [id, title]));

const d1FollowsRecipe = async (mealId: string) =>
	(
		await d1
			.prepare('SELECT follows_recipe FROM meals WHERE id = ?')
			.bind(mealId)
			.first<{ follows_recipe: number }>()
	)?.follows_recipe;

describe('recipe-following meals across devices', () => {
	test('another member sees the recipe a following meal references', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();

		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		// Bob holds Alice's recipe only to show the meal; his menu lists his own recipes.
		await expect(bobDevice.database.recipes.get(recipe.id)).resolves.toMatchObject({
			ownerUserId: alice.userId
		});
	});

	test('a recipe edit reaches upcoming meals, and the Worker copies past meals first', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const past = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2020-01-01'
		});
		const upcoming = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		await bobDevice.sync();

		await commitRecipe({ ...recipe, title: 'Changed soup' }, ['header']);

		expect(await d1FollowsRecipe(past.id)).toBe(0);
		expect(await d1FollowsRecipe(upcoming.id)).toBe(1);
		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(
			new Map([
				[past.id, 'Sunday soup'],
				[upcoming.id, 'Changed soup']
			])
		);
	});

	test('two devices that copy the same meal converge without a conflict notice', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		await bobDevice.sync();

		// Both check in before either syncs, so each device copies the recipe into the meal.
		await saveMealCheckIn(aliceDevice.database, aliceDevice.context, meal.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await saveMealCheckIn(bobDevice.database, bobDevice.context, meal.id, {
			status: 'cooked',
			verdict: 'neutral'
		});
		await aliceDevice.sync();
		await bobDevice.sync();
		await aliceDevice.sync();

		const stored = await Promise.all(
			[aliceDevice, bobDevice].map(
				async ({ database }) => (await database.meals.get(meal.id)) as StoredMeal
			)
		);
		expect(stored[0]).toEqual(stored[1]);
		expect(isRecipeFollowingMeal(stored[0]!)).toBe(false);
		expect(await d1FollowsRecipe(meal.id)).toBe(0);
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		await expect(
			bobDevice.database.outbox.where('aggregateId').equals(meal.id).toArray()
		).resolves.toContainEqual(expect.objectContaining({ rejectionCode: 'meal_already_copied' }));
		await expect(readUnseenRejections(bobDevice.database)).resolves.toEqual([]);
		await expect(
			bobDevice.database.mealCheckIns.where('mealId').equals(meal.id).count()
		).resolves.toBe(2);
	});

	test('a meal that reaches D1 before its recipe is retried, not stored without it', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await commitImportedRecipeCandidate(
			aliceDevice.database,
			{
				authSlotId: alice.slot,
				ownerUserId: alice.userId,
				originDeviceId: aliceDevice.context.originDeviceId
			},
			candidateFromToolRecipe({ title: 'Sunday soup' })
		);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		const push = async () =>
			pushHouseholdSync(new D1HouseholdSyncRepository(d1), householdId, alice.userId, {
				protocolVersion: 1,
				deviceId: aliceDevice.context.originDeviceId,
				audience: { kind: 'household', id: householdId },
				baseCursor: null,
				mutations: [
					{
						schemaVersion: CURRENT_SCHEMA_VERSION,
						mutationId: uuidv7(),
						originDeviceId: aliceDevice.context.originDeviceId,
						entityKind: 'meal',
						entityId: meal.id,
						conflictGroups: [...MEAL_CONFLICT_GROUPS],
						operation: 'upsert',
						occurredAt: new Date().toISOString() as `${string}Z`,
						aggregate: await aliceDevice.database.meals.get(meal.id)
					}
				]
			});

		await expect(push()).rejects.toMatchObject({ code: 'source_recipe_pending' });
		expect(await d1FollowsRecipe(meal.id)).toBeUndefined();

		await commitRecipe(recipe, ['header', 'ingredients', 'instructions']);
		const { receipts } = await push();
		expect(receipts[0]).toMatchObject({ status: 'accepted' });
		expect(await d1FollowsRecipe(meal.id)).toBe(1);
	});
});
