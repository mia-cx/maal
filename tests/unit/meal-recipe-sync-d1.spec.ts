import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import type { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { finalizeProfileSignOut, removeProfileFromDevice } from '$lib/client/local/profiles.js';
import {
	listHouseholdMeals,
	planRecipeAsMeal,
	saveMealCheckIn,
	updateMealHeader,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import {
	commitPortableImport,
	decodePortableArchive,
	exportPortableArchive,
	planPortableImport
} from '$lib/client/portability/index.js';
import { commitImportedRecipeCandidate } from '$lib/client/recipes/index.js';
import {
	createHouseholdSyncCoordinator,
	type HouseholdSyncTransport
} from '$lib/client/sync/index.js';
import { readUnseenRejections } from '$lib/client/sync/rejections.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { planRecipeFollowingMeal } from '$lib/domain/meals/recipe-following.js';
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

/**
 * One member's device, signed in and paid, with a coordinator talking to the real D1 services.
 * Pass another member's `database` to sign this member in on the same device.
 */
const openDevice = async (member: typeof alice, shared?: MaalDatabase) => {
	const database = shared ?? (await openMaalDatabase(`meal-recipe-sync-${crypto.randomUUID()}`));
	if (!shared) devices.push(database);
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
const commitRecipe = async (
	recipe: RecipeAggregate,
	groups: readonly string[],
	database: D1Database = d1
) => {
	const receipt = await new D1UserSyncRepository(database).commit({
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
	// Her user sync acknowledged the upload, so no unsent edit holds the recipe back.
	await device.database.outbox.where('aggregateId').equals(recipe.id).delete();
	return recipe;
};

/** Pushes one meal mutation straight to the household sync service. */
const pushMeal = async (
	actorUserId: string,
	meal: unknown,
	groups: readonly string[] = MEAL_CONFLICT_GROUPS,
	database: D1Database = d1
) =>
	(
		await pushHouseholdSync(new D1HouseholdSyncRepository(database), householdId, actorUserId, {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'household', id: householdId },
			baseCursor: null,
			mutations: [
				{
					schemaVersion: CURRENT_SCHEMA_VERSION,
					mutationId: uuidv7(),
					originDeviceId: uuidv7(),
					entityKind: 'meal',
					entityId: (meal as { id: string }).id,
					conflictGroups: [...groups] as [string, ...string[]],
					operation: 'upsert',
					occurredAt: new Date().toISOString() as `${string}Z`,
					aggregate: meal
				}
			]
		})
	).receipts[0]!;

/**
 * D1 that runs `write` just before its next batch commits, as when another request lands between
 * a commit's reads and its write.
 */
const beforeNextBatch = (write: () => Promise<unknown>): D1Database => {
	let pending: (() => Promise<unknown>) | undefined = write;
	return new Proxy(d1, {
		get(target, key) {
			if (key === 'batch') {
				return async (statements: D1PreparedStatement[]) => {
					const run = pending;
					pending = undefined;
					await run?.();
					return target.batch(statements);
				};
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
};

/**
 * D1 that runs `write` once, right after the first query whose SQL contains `fragment` returns, as
 * when another request lands between two of a commit's reads.
 */
const afterQuery = (fragment: string, write: () => Promise<unknown>): D1Database => {
	let pending: (() => Promise<unknown>) | undefined = write;
	const watch = (statement: D1PreparedStatement): D1PreparedStatement =>
		new Proxy(statement, {
			get(target, key) {
				const value = Reflect.get(target, key) as unknown;
				if (typeof value !== 'function') return value;
				if (key === 'bind') {
					return (...values: unknown[]) => watch(value.apply(target, values));
				}
				if (key !== 'all' && key !== 'first') return value.bind(target);
				return async (...args: unknown[]) => {
					const result = await value.apply(target, args);
					const run = pending;
					pending = undefined;
					await run?.();
					return result;
				};
			}
		});
	return new Proxy(d1, {
		get(target, key) {
			if (key === 'prepare') {
				return (sql: string) =>
					sql.includes(fragment) ? watch(target.prepare(sql)) : target.prepare(sql);
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
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

describe('who can follow a recipe', () => {
	test('a member cannot pull another member’s private recipe into the household by its ID', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await aliceSavesRecipe(aliceDevice);
		await commitRecipe({ ...recipe, title: 'Secret soup' }, ['header']);
		// Bob kept an old copy from a household they no longer share, and plans it here.
		await bobDevice.database.table('recipes').put(recipe);
		const meal = await planRecipeAsMeal(bobDevice.database, bobDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await bobDevice.sync();

		await expect(readUnseenRejections(bobDevice.database)).resolves.toEqual([
			expect.objectContaining({
				message:
					'Your change to “Sunday soup” wasn’t saved because its recipe belongs to someone else.'
			})
		]);
		// A schedule-only write cannot slip the reference in either.
		await expect(
			pushMeal(bob.userId, await bobDevice.database.meals.get(meal.id), ['schedule'])
		).resolves.toMatchObject({
			status: 'rejected',
			errorCode: 'recipe_not_shared'
		});
		expect(await d1FollowsRecipe(meal.id)).toBeUndefined();
		const household = await d1
			.prepare(`SELECT payload FROM sync_changes WHERE audience_kind = 'household'`)
			.all<{ payload: string }>();
		expect(JSON.stringify(household.results)).not.toContain('Secret soup');
		await bobDevice.sync();
		await expect(bobDevice.database.recipes.get(recipe.id)).resolves.toMatchObject({
			title: 'Sunday soup'
		});
	});

	test('a member may plan a recipe the household already receives', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await aliceSavesRecipe(aliceDevice);
		await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();

		const bobsMeal = planRecipeFollowingMeal({
			recipe,
			householdId,
			mealId: uuidv7(),
			occurredAt: new Date().toISOString()
		});
		await expect(pushMeal(bob.userId, bobsMeal)).resolves.toMatchObject({ status: 'accepted' });
	});
});

describe('recipe changes racing meal writes', () => {
	test('a past meal written while a recipe edit commits still keeps the old recipe', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const past = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2020-01-01'
		});

		await commitRecipe(
			{ ...recipe, title: 'Changed soup' },
			['header'],
			// The meal lands after the edit chose which meals to copy, before the edit commits.
			beforeNextBatch(async () =>
				expect(
					await pushMeal(alice.userId, await aliceDevice.database.meals.get(past.id))
				).toMatchObject({ status: 'accepted' })
			)
		);

		expect(await d1FollowsRecipe(past.id)).toBe(0);
		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[past.id, 'Sunday soup']]));
	});

	test('a past meal planned after a recipe edit chose its copies still keeps the old recipe', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const past = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2020-01-01'
		});

		await commitRecipe(
			{ ...recipe, title: 'Changed soup' },
			['header'],
			// The meal lands just after the edit selected the meals to copy.
			afterQuery('FROM meals m JOIN households h', async () =>
				expect(
					await pushMeal(alice.userId, await aliceDevice.database.meals.get(past.id))
				).toMatchObject({ status: 'accepted' })
			)
		);

		expect(await d1FollowsRecipe(past.id)).toBe(0);
		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[past.id, 'Sunday soup']]));
	});

	test('a meal cooked after a recipe edit read it still keeps the old recipe', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		const cooked = { ...(await aliceDevice.database.meals.get(meal.id))!, status: 'cooked' };

		await commitRecipe(
			{ ...recipe, title: 'Changed soup' },
			['header'],
			// The status lands just after the edit read the meal as planned, so it chose no copy.
			afterQuery('SELECT * FROM "meals" WHERE household_id', async () =>
				expect(await pushMeal(alice.userId, cooked, ['status'])).toMatchObject({
					status: 'accepted'
				})
			)
		);

		expect(await d1FollowsRecipe(meal.id)).toBe(0);
		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
	});

	test('a meal planned while its recipe changes shares the changed recipe', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		const recipe = await aliceSavesRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});

		await expect(
			pushMeal(
				alice.userId,
				await aliceDevice.database.meals.get(meal.id),
				MEAL_CONFLICT_GROUPS,
				// The edit lands after the meal read the recipe, before the meal commits.
				beforeNextBatch(() => commitRecipe({ ...recipe, title: 'Changed soup' }, ['header']))
			)
		).resolves.toMatchObject({ status: 'accepted' });

		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Changed soup']]));
	});
});

describe('archives and shared devices', () => {
	test('replacing a meal copy from an archive updates it for the household', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await aliceSavesRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await updateMealHeader(aliceDevice.database, aliceDevice.context, meal.id, {
			title: 'Leftover soup',
			description: null,
			cookTimeMinutes: null
		});
		await aliceDevice.sync();
		await aliceDevice.database.households.put({
			householdId,
			name: 'Family kitchen',
			locale: 'en-US',
			timezone: null,
			weekStartsOn: 1,
			defaultPlannedYield: 4,
			preferredDinnerTime: '18:00',
			stalenessThresholdMinutes: 180,
			createdByUserId: alice.userId,
			deletionState: 'active',
			localOnly: false,
			schemaVersion: 1,
			revision: 1,
			createdAt: joinedAt,
			updatedAt: joinedAt,
			deletedAt: null,
			conflictClocks: {}
		});
		const archive = await decodePortableArchive(
			await exportPortableArchive(aliceDevice.database, alice.profileId)
		);
		await updateMealHeader(aliceDevice.database, aliceDevice.context, meal.id, {
			title: 'Renamed soup',
			description: null,
			cookTimeMinutes: null
		});
		await aliceDevice.sync();

		const preview = await planPortableImport(aliceDevice.database, archive, alice.profileId);
		const replaceMeal = Object.fromEntries(
			preview.collisions.map(({ collisionId, store }) => [
				collisionId,
				store === 'meals' ? ('replace' as const) : ('keep-local' as const)
			])
		);
		await commitPortableImport(
			aliceDevice.database,
			await planPortableImport(aliceDevice.database, archive, alice.profileId, replaceMeal)
		);
		await aliceDevice.sync();

		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Leftover soup']]));
	});

	test('a recipe edit reaches the household view after its owner signs out of a shared device', async () => {
		const device = await openDevice(alice);
		const bobOnDevice = await openDevice(bob, device.database);
		const recipe = await aliceSavesRecipe(device);
		const meal = await planRecipeAsMeal(device.database, device.context, recipe.id, {
			date: '2099-01-01'
		});
		await device.sync();
		await finalizeProfileSignOut(device.database, alice.profileId);

		// Alice edits the recipe on her phone.
		await commitRecipe({ ...recipe, title: 'Changed soup' }, ['header']);
		await bobOnDevice.sync();

		expect(await titles(device.database)).toEqual(new Map([[meal.id, 'Changed soup']]));
	});

	test('removing a profile keeps the recipes that the remaining household’s meals follow', async () => {
		const device = await openDevice(alice);
		await openDevice(bob, device.database);
		const context = {
			authSlotId: alice.slot,
			ownerUserId: alice.userId,
			originDeviceId: device.context.originDeviceId
		};
		// Free use: nothing reaches D1, so this device holds the only copy.
		const followed = await commitImportedRecipeCandidate(
			device.database,
			context,
			candidateFromToolRecipe({ title: 'Sunday soup' })
		);
		const unplanned = await commitImportedRecipeCandidate(
			device.database,
			context,
			candidateFromToolRecipe({ title: 'Private soup' })
		);
		const meal = await planRecipeAsMeal(device.database, device.context, followed.id, {
			date: '2099-01-01'
		});

		const removed = await removeProfileFromDevice(device.database, alice.profileId);

		expect(removed.retainedHouseholdIds).toEqual([householdId]);
		expect(await titles(device.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		await expect(device.database.recipes.get(unplanned.id)).resolves.toBeUndefined();
	});
});
