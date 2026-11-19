import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import type { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	detachHouseholdSnapshot,
	forkDetachedHouseholdSnapshot
} from '$lib/client/local/households.js';
import { removeProfileFromDevice } from '$lib/client/local/profiles.js';
import {
	listHouseholdMeals,
	planRecipeAsMeal,
	saveMealCheckIn,
	updateMealHeader,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { exportRecoveryArchives } from '$lib/client/local/recovery-export.js';
import {
	bulkResolutions,
	commitPortableImport,
	decodePortableArchive,
	exportPortableArchive,
	planPortableImport
} from '$lib/client/portability/index.js';
import {
	commitImportedRecipeCandidate,
	permanentlyDeleteRecipe,
	updateRecipeFromEditor
} from '$lib/client/recipes/index.js';
import {
	createHouseholdSyncCoordinator,
	createUserSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncTransport
} from '$lib/client/sync/index.js';
import { readUnseenRejections } from '$lib/client/sync/rejections.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { planRecipeFollowingMeal } from '$lib/domain/meals/recipe-following.js';
import { MEAL_CONFLICT_GROUPS } from '$lib/domain/meals/schema.js';
import { newestContentVersion, recipeVersion } from '$lib/domain/recipes/versions.js';
import { D1RemoteDomainPort } from '$lib/server/domain/remote-port.js';
import { HouseholdAdministrationRepository } from '$lib/server/household-administration/repository.js';
import { candidateFromToolRecipe } from '$lib/server/mcp/builders.js';
import {
	D1HouseholdSyncRepository,
	D1UserSyncRepository,
	backfillHouseholdSync,
	backfillUserSync,
	bootstrapHouseholdSync,
	bootstrapUserSync,
	pullHouseholdSync,
	pullUserSync,
	pushHouseholdSync,
	pushUserSync
} from '$lib/server/sync/index.js';
import { readRecipeVersions } from '$lib/server/sync/recipe-versions.js';

import { MCP_TEST_DEVICE, createMcpTestDatabase } from './mcp-test-helpers.js';

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

const environment = {
	isOnline: () => true,
	isVisible: () => true,
	isSaveDataEnabled: () => false,
	on: () => () => undefined
};

/**
 * One member's device, signed in and paid, whose user and household coordinators talk to the real
 * D1 services through `database`. Pass another member's `shared` database to sign this member in
 * on the same device.
 */
const openDevice = async (
	member: typeof alice,
	shared?: MaalDatabase,
	database: D1Database = d1
) => {
	const local = shared ?? (await openMaalDatabase(`meal-recipe-sync-${crypto.randomUUID()}`));
	if (!shared) devices.push(local);
	await local.profiles.put({
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
	await local.uiState.put({ key: 'activeProfileId', value: member.profileId });
	await local.authSlots.put({
		authSlotId: member.slot,
		profileId: member.profileId,
		workosUserId: member.userId,
		sessionState: 'authenticated',
		lastRefreshedAt: joinedAt,
		lastVerifiedAt: joinedAt,
		nextRetryAt: null,
		retryCount: 0
	});
	await local.memberships.put({
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
	await local.billingCapabilities.put({
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
	const users = new D1UserSyncRepository(database);
	const userTransport: UserSyncTransport = {
		pull: async (_slot, request) => pullUserSync(users, member.userId, request),
		push: async (_slot, request) => pushUserSync(users, member.userId, request),
		bootstrap: async (_slot, request) => bootstrapUserSync(users, member.userId, request),
		backfill: async (_slot, request) => backfillUserSync(users, member.userId, request)
	};
	const households = new D1HouseholdSyncRepository(database);
	const householdTransport: HouseholdSyncTransport = {
		pull: async (_slot, request) => pullHouseholdSync(households, householdId, request),
		push: async (_slot, request) =>
			pushHouseholdSync(households, householdId, member.userId, request),
		bootstrap: async (_slot, request) => bootstrapHouseholdSync(households, householdId, request),
		backfill: async (_slot, request) =>
			backfillHouseholdSync(households, householdId, member.userId, request)
	};
	const userSync = createUserSyncCoordinator({
		database: local,
		authSlotId: member.slot,
		workosUserId: member.userId,
		transport: userTransport,
		capabilityResolver: async () => ({ enabled: true, stale: false, householdId }),
		environment
	});
	const householdSync = createHouseholdSyncCoordinator({
		database: local,
		authSlotId: member.slot,
		workosUserId: member.userId,
		householdId,
		transport: householdTransport,
		environment
	});
	const originDeviceId = (await local.meta.get('deviceId'))!.value as string;
	const context: MealCommandContext = {
		authSlotId: member.slot,
		householdId,
		reporterUserId: member.userId,
		originDeviceId
	};
	return {
		database: local,
		context,
		recipeContext: (occurredAt?: `${string}Z`) => ({
			authSlotId: member.slot,
			ownerUserId: member.userId,
			originDeviceId,
			...(occurredAt ? { occurredAt } : {})
		}),
		syncUser: async () => {
			expect(await userSync.syncNow()).toBe('complete');
		},
		/** User sync first, as the app does, so a meal's recipe versions reach D1 before the meal. */
		sync: async () => {
			expect(await userSync.syncNow()).toBe('complete');
			expect(await householdSync.syncNow()).toBe('complete');
		}
	};
};

type Device = Awaited<ReturnType<typeof openDevice>>;

const saveRecipe = (device: Device, occurredAt?: `${string}Z`) =>
	commitImportedRecipeCandidate(
		device.database,
		device.recipeContext(occurredAt),
		candidateFromToolRecipe({
			title: 'Sunday soup',
			ingredients: ['800 g tomatoes'],
			instructions: ['Simmer for 20 minutes.']
		})
	);

const editRecipe = (device: Device, recipeId: string, title: string, occurredAt?: `${string}Z`) =>
	updateRecipeFromEditor(device.database, device.recipeContext(occurredAt), recipeId, {
		title,
		description: null,
		imageUrl: null,
		sourceUrl: null,
		sourceSiteName: null,
		sourceAuthorName: null,
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		prepTimeMinutes: null,
		cookTimeMinutes: 5,
		yield: 2,
		ingredients: [{ id: null, amount: '1', unit: 'kg', item: 'tomatoes' }],
		instructions: [{ id: null, position: 1, text: 'Simmer.' }]
	});

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
 * D1 that runs `write` just before its next batch commits once `ready` holds, as when another request
 * lands then.
 */
const beforeNextBatch = (
	write: () => Promise<unknown>,
	ready: () => Promise<boolean> = async () => true
): D1Database => {
	let pending: (() => Promise<unknown>) | undefined = write;
	return new Proxy(d1, {
		get(target, key) {
			if (key === 'batch') {
				return async (statements: D1PreparedStatement[]) => {
					if (pending !== undefined && (await ready())) {
						const run = pending;
						pending = undefined;
						await run();
					}
					return target.batch(statements);
				};
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
};

/** D1 that runs `after` once its next batch commits, as when its response is lost or another request lands then. */
const afterNextBatch = (after: () => Promise<unknown>): D1Database => {
	let pending: (() => Promise<unknown>) | undefined = after;
	return new Proxy(d1, {
		get(target, key) {
			if (key === 'batch') {
				return async (statements: D1PreparedStatement[]) => {
					const result = await target.batch(statements);
					const run = pending;
					pending = undefined;
					await run?.();
					return result;
				};
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
};

const titles = async (database: MaalDatabase) =>
	new Map((await listHouseholdMeals(database, householdId)).map(({ id, title }) => [id, title]));

const storedVersionIds = async (recipeId: string) =>
	(
		await d1
			.prepare('SELECT id FROM recipe_versions WHERE recipe_id = ? ORDER BY effective_at')
			.bind(recipeId)
			.all<{ id: string }>()
	).results.map(({ id }) => id);

/** Pushes recipe versions straight to the owner's user sync service. */
const pushVersions = async (
	actorUserId: string,
	versions: readonly unknown[],
	database: D1Database = d1
) =>
	(
		await pushUserSync(new D1UserSyncRepository(database), actorUserId, {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'user', id: actorUserId },
			baseCursor: null,
			mutations: versions.map((version) => ({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: uuidv7(),
				entityKind: 'recipeVersion' as const,
				entityId: (version as { id: string }).id,
				conflictGroups: ['row'] as [string],
				operation: 'upsert' as const,
				occurredAt: (version as { effectiveAt: `${string}Z` }).effectiveAt,
				aggregate: version
			}))
		})
	).receipts;

describe('recipe versions across devices', () => {
	test('another member resolves every meal to the same version and never gets the recipe', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(aliceDevice);
		const plan = (date: string) =>
			planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, { date });
		const past = await plan('2020-01-01');
		const future = await plan('2099-01-01');
		const cooked = await plan('2099-01-02');
		await aliceDevice.sync();
		await bobDevice.sync();
		await saveMealCheckIn(bobDevice.database, bobDevice.context, cooked.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await bobDevice.sync();

		await editRecipe(aliceDevice, recipe.id, 'Changed soup');
		await aliceDevice.sync();
		await bobDevice.sync();

		const expected = new Map([
			[past.id, 'Sunday soup'],
			[future.id, 'Changed soup'],
			[cooked.id, 'Sunday soup']
		]);
		expect(await titles(aliceDevice.database)).toEqual(expected);
		expect(await titles(bobDevice.database)).toEqual(expected);
		// Bob receives the versions, never the recipe, so it stays out of his menu.
		await expect(bobDevice.database.recipes.get(recipe.id)).resolves.toBeUndefined();
		await expect(bobDevice.database.recipeVersions.count()).resolves.toBe(2);
	});

	test('a meal that reaches D1 before its recipe’s versions is retried, not stored without them', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});

		await expect(
			pushMeal(alice.userId, await aliceDevice.database.meals.get(meal.id))
		).rejects.toMatchObject({ code: 'source_recipe_pending' });
		await expect(
			d1.prepare('SELECT 1 FROM meals WHERE id = ?').bind(meal.id).first()
		).resolves.toBeNull();

		await aliceDevice.sync();
		await expect(
			d1.prepare('SELECT followed_recipe_id FROM meals WHERE id = ?').bind(meal.id).first()
		).resolves.toEqual({ followed_recipe_id: recipe.id });
	});

	test('two members who copy the same meal converge on the first copy without a notice', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		await bobDevice.sync();
		const rename = (device: Device, title: string) =>
			updateMealHeader(device.database, device.context, meal.id, {
				title,
				description: null,
				cookTimeMinutes: null
			});

		// Alice copies the edited recipe; Bob, who has not seen the edit yet, copies the old one.
		await editRecipe(aliceDevice, recipe.id, 'Changed soup');
		await aliceDevice.sync();
		await rename(aliceDevice, 'Alice’s soup');
		await aliceDevice.sync();
		await rename(bobDevice, 'Bob’s soup');
		await bobDevice.sync();
		await aliceDevice.sync();

		for (const device of [aliceDevice, bobDevice]) {
			const [shown] = await listHouseholdMeals(device.database, householdId);
			// Bob's header edit applies; his copy reached Alice's and changed no content.
			expect(shown).toMatchObject({ id: meal.id, title: 'Bob’s soup' });
			expect(shown!.ingredients.map(({ originalText }) => originalText)).toEqual(['1 kg tomatoes']);
			await expect(readUnseenRejections(device.database)).resolves.toEqual([]);
		}
	});

	test('the newest version matches the recipe after concurrent edits from two devices', async () => {
		const phone = await openDevice(alice);
		const laptop = await openDevice(alice);
		const recipe = await saveRecipe(phone, '2026-01-01T10:00:00.000Z');
		const meal = await planRecipeAsMeal(phone.database, phone.context, recipe.id, {
			date: '2099-01-01'
		});
		await phone.sync();
		await laptop.sync();

		// The phone edits first while offline; the laptop edits later and syncs first, so the
		// phone's older edit wins the recipe by commit order.
		await editRecipe(phone, recipe.id, 'Phone soup', '2026-01-02T10:00:00.000Z');
		await editRecipe(laptop, recipe.id, 'Laptop soup', '2026-01-02T11:00:00.000Z');
		await laptop.sync();
		await phone.sync();
		await laptop.sync();

		await expect(laptop.database.recipes.get(recipe.id)).resolves.toMatchObject({
			title: 'Phone soup'
		});
		expect(await titles(phone.database)).toEqual(new Map([[meal.id, 'Phone soup']]));
		expect(await titles(laptop.database)).toEqual(new Map([[meal.id, 'Phone soup']]));
	});

	test('an edit that lands while the Worker matches an older winning edit stays the newest version', async () => {
		const tablet = await openDevice(alice);
		const laptop = await openDevice(alice);
		const recipe = await saveRecipe(tablet, '2026-01-01T10:00:00.000Z');
		await tablet.sync();
		await laptop.sync();
		await editRecipe(laptop, recipe.id, 'Laptop soup', '2026-01-03T10:00:00.000Z');
		await laptop.sync();
		await tablet.sync();
		await editRecipe(tablet, recipe.id, 'Newer concurrent edit', '2026-01-04T10:00:00.000Z');
		const storedTitle = async () =>
			(
				await d1
					.prepare('SELECT title FROM recipes WHERE id = ?')
					.bind(recipe.id)
					.first<{ title: string }>()
			)?.title;

		// The phone's older edit wins by commit order, so the Worker adds a version matching it. The
		// tablet's newer edit commits just before that version would.
		const phone = await openDevice(
			alice,
			undefined,
			beforeNextBatch(
				() => tablet.sync(),
				async () => (await storedTitle()) === 'Older winning edit'
			)
		);
		await phone.sync();
		await editRecipe(phone, recipe.id, 'Older winning edit', '2026-01-02T10:00:00.000Z');
		await phone.sync();

		await expect(storedTitle()).resolves.toBe('Newer concurrent edit');
		expect(newestContentVersion(await readRecipeVersions(d1, [recipe.id]))?.recipe.title).toBe(
			'Newer concurrent edit'
		);
	});
});

describe('recipe writes from MCP tools', () => {
	test('an earlier-started request that commits last leaves the newest version matching the recipe', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice, '2026-01-01T10:00:00.000Z');
		await aliceDevice.sync();
		const write = (port: D1RemoteDomainPort, title: string) =>
			port.writeUserRecipe({
				actorUserId: alice.userId,
				aggregate: { ...recipe, title },
				conflictGroups: ['header'],
				operation: 'upsert'
			});
		// Request B starts later and commits its recipe and version completely while request A waits
		// just before its recipe batch; A then wins the recipe by commit order.
		const laterRequest = async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			await write(new D1RemoteDomainPort(d1, MCP_TEST_DEVICE), 'Later request');
		};
		await write(
			new D1RemoteDomainPort(beforeNextBatch(laterRequest), MCP_TEST_DEVICE),
			'Last committed request'
		);

		await expect(
			d1.prepare('SELECT title FROM recipes WHERE id = ?').bind(recipe.id).first()
		).resolves.toEqual({ title: 'Last committed request' });
		expect(newestContentVersion(await readRecipeVersions(d1, [recipe.id]))?.recipe.title).toBe(
			'Last committed request'
		);
	});

	test('an edit whose batch response is lost still commits its version', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice);
		await aliceDevice.sync();
		const lostResponse = afterNextBatch(async () => {
			throw new Error('batch committed, then the response was lost');
		});

		await expect(
			new D1RemoteDomainPort(lostResponse, MCP_TEST_DEVICE).writeUserRecipe({
				actorUserId: alice.userId,
				aggregate: { ...recipe, title: 'Acknowledged edit' },
				conflictGroups: ['header'],
				operation: 'upsert'
			})
		).resolves.toMatchObject({ title: 'Acknowledged edit' });
		expect(newestContentVersion(await readRecipeVersions(d1, [recipe.id]))?.recipe.title).toBe(
			'Acknowledged edit'
		);
	});

	test('a meal planned before a deletion keeps its content when an edit revives the recipe at once', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice, '2026-01-01T10:00:00.000Z');
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		const deletedAt = new Date().toISOString() as `${string}Z`;
		// A recent edit from another request revives the recipe as soon as the deletion commits.
		const revive = () =>
			new D1RemoteDomainPort(d1, MCP_TEST_DEVICE).writeUserRecipe({
				actorUserId: alice.userId,
				aggregate: { ...recipe, title: 'Restored edit' },
				conflictGroups: ['header'],
				operation: 'upsert'
			});

		await new D1RemoteDomainPort(afterNextBatch(revive), MCP_TEST_DEVICE).writeUserRecipe({
			actorUserId: alice.userId,
			aggregate: { ...recipe, deletedAt, updatedAt: deletedAt },
			conflictGroups: ['deletion'],
			operation: 'delete'
		});

		await expect(
			d1.prepare('SELECT title, deleted_at FROM recipes WHERE id = ?').bind(recipe.id).first()
		).resolves.toEqual({ title: 'Restored edit', deleted_at: null });
		await expect(
			new D1RemoteDomainPort(d1, MCP_TEST_DEVICE).getHouseholdMeal(householdId, meal.id)
		).resolves.toMatchObject({ title: 'Sunday soup' });
	});
});

describe('purging a recipe', () => {
	test('removes its versions only while no meal or check-in references it', async () => {
		const aliceDevice = await openDevice(alice);
		const planned = await saveRecipe(aliceDevice);
		const unplanned = await saveRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, planned.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();

		for (const { id } of [planned, unplanned]) {
			await permanentlyDeleteRecipe(aliceDevice.database, aliceDevice.recipeContext(), id);
		}
		await aliceDevice.sync();

		await expect(storedVersionIds(unplanned.id)).resolves.toEqual([]);
		await expect(
			aliceDevice.database.recipeVersions.where('recipeId').equals(unplanned.id).count()
		).resolves.toBe(0);
		await expect(storedVersionIds(planned.id)).resolves.not.toEqual([]);
		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
	});

	test('keeps the versions when a meal following the recipe commits just before the purge', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice);
		await aliceDevice.sync();
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		const stored = await aliceDevice.database.meals.get(meal.id);
		await aliceDevice.database.meals.delete(meal.id);
		await aliceDevice.database.outbox.where('aggregateId').equals(meal.id).delete();
		await permanentlyDeleteRecipe(aliceDevice.database, aliceDevice.recipeContext(), recipe.id);
		// The meal reaches D1 just before the purge's batch, after the device decided to purge.
		const purgeBatch = beforeNextBatch(() => pushMeal(alice.userId, stored));
		const purging = await openDevice(alice, aliceDevice.database, purgeBatch);
		await purging.syncUser();

		await expect(
			d1.prepare('SELECT 1 FROM recipes WHERE id = ?').bind(recipe.id).first()
		).resolves.toBeNull();
		await expect(storedVersionIds(recipe.id)).resolves.not.toEqual([]);
	});
});

describe('who can follow and version a recipe', () => {
	test('a member cannot follow or version another member’s private recipe, and learns nothing', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(aliceDevice);
		await editRecipe(aliceDevice, recipe.id, 'Secret soup');
		await aliceDevice.sync();
		const now = new Date().toISOString();

		await expect(
			pushMeal(
				bob.userId,
				planRecipeFollowingMeal({ recipe, householdId, mealId: uuidv7(), occurredAt: now })
			)
		).resolves.toMatchObject({ status: 'rejected', errorCode: 'recipe_not_shared' });
		// Nor can Bob add a version that would change what Alice's meals show.
		const forged = recipeVersion({
			id: uuidv7(),
			recipeId: recipe.id,
			ownerUserId: bob.userId,
			effectiveAt: now,
			recipe: { ...recipe, ownerUserId: bob.userId, title: 'Forged soup' }
		});
		await expect(pushVersions(bob.userId, [forged])).resolves.toMatchObject([
			{ status: 'rejected', errorCode: 'recipe_not_owned' }
		]);

		await bobDevice.sync();
		await expect(bobDevice.database.recipeVersions.count()).resolves.toBe(0);
		const household = await d1
			.prepare(`SELECT payload FROM sync_changes WHERE audience_kind = 'household'`)
			.all<{ payload: string }>();
		expect(JSON.stringify(household.results)).not.toContain('Secret soup');
		expect(await storedVersionIds(recipe.id)).toHaveLength(2);
	});

	test('a member may plan a recipe the household already receives', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice);
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

describe('a member leaving the household', () => {
	const revoke = (userId: string, database: D1Database = d1) =>
		new HouseholdAdministrationRepository(database).markMembershipRevoked(
			`membership_${userId}`,
			new Date().toISOString()
		);

	const followers = async (recipeId: string) =>
		(
			await d1
				.prepare('SELECT id FROM meals WHERE followed_recipe_id = ?')
				.bind(recipeId)
				.all<{ id: string }>()
		).results.map(({ id }) => id);

	test('copies the meals of their recipes as they showed, and their later edits stay private', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		await bobDevice.sync();

		await revoke(alice.userId);
		await editRecipe(aliceDevice, recipe.id, 'Private after leaving');
		await aliceDevice.syncUser();
		await bobDevice.sync();

		await expect(followers(recipe.id)).resolves.toEqual([]);
		await expect(bobDevice.database.meals.get(meal.id)).resolves.toMatchObject({
			title: 'Sunday soup',
			sourceRecipeId: recipe.id
		});
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		const port = new D1RemoteDomainPort(d1, MCP_TEST_DEVICE);
		await expect(port.getHouseholdMeal(householdId, meal.id)).resolves.toMatchObject({
			title: 'Sunday soup',
			followsRecipe: false
		});
	});

	test.each([
		[
			'a new meal of their recipe commits between the revocation’s reads and its write',
			'meal-first'
		],
		['the revocation commits between a new meal’s reads and its write', 'revocation-first']
	] as const)('converges when %s', async (_name, order) => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice);
		await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await aliceDevice.sync();
		const late = planRecipeFollowingMeal({
			recipe,
			householdId,
			mealId: uuidv7(),
			occurredAt: new Date().toISOString()
		});
		const pushLate = (database?: D1Database) => pushMeal(alice.userId, late, undefined, database);

		if (order === 'meal-first') {
			await revoke(
				alice.userId,
				beforeNextBatch(() => pushLate())
			);
			await expect(
				d1.prepare('SELECT title FROM meals WHERE id = ?').bind(late.id).first()
			).resolves.toEqual({ title: 'Sunday soup' });
		} else {
			await expect(pushLate(beforeNextBatch(() => revoke(alice.userId)))).resolves.toMatchObject({
				status: 'rejected',
				errorCode: 'recipe_not_shared'
			});
		}

		await expect(followers(recipe.id)).resolves.toEqual([]);
	});
});

describe('a recipe edit racing the first meal of it', () => {
	test.each([
		['the edit commits between the meal’s reads and its write', 'meal-first'],
		['the meal commits between the edit’s reads and its write', 'edit-first']
	] as const)('the household gets the edit when %s', async (_name, order) => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(aliceDevice);
		await aliceDevice.sync();
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await editRecipe(aliceDevice, recipe.id, 'Changed soup');
		const edit = (await aliceDevice.database.recipeVersions.toArray()).find(
			(version) => (version.recipe as { title: string }).title === 'Changed soup'
		)!;
		const pushEdit = (database?: D1Database) => pushVersions(alice.userId, [edit], database);
		const pushPlan = async (database?: D1Database) =>
			pushMeal(alice.userId, await aliceDevice.database.meals.get(meal.id), undefined, database);

		if (order === 'meal-first') await pushPlan(beforeNextBatch(pushEdit));
		else await pushEdit(beforeNextBatch(pushPlan));
		await bobDevice.sync();

		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Changed soup']]));
	});
});

/** The household row a device holds, which an export needs. */
const familyKitchen = {
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
} as const;

describe('archives and shared devices', () => {
	test('export and import round-trip a following meal, its versions, and its pin', async () => {
		const aliceDevice = await openDevice(alice);
		const recipe = await saveRecipe(aliceDevice);
		const meal = await planRecipeAsMeal(aliceDevice.database, aliceDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await saveMealCheckIn(aliceDevice.database, aliceDevice.context, meal.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await editRecipe(aliceDevice, recipe.id, 'Changed soup');
		await aliceDevice.database.households.put(familyKitchen);
		const archive = await decodePortableArchive(
			await exportPortableArchive(aliceDevice.database, alice.profileId)
		);

		const restored = await openDevice(alice);
		await restored.database.households.put(
			(await aliceDevice.database.households.get(householdId))!
		);
		await commitPortableImport(
			restored.database,
			await planPortableImport(restored.database, archive, alice.profileId)
		);

		// The meal still follows its recipe and shows the version its check-in pinned.
		expect(await titles(restored.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		await expect(restored.database.recipeVersions.count()).resolves.toBe(2);
		await expect(restored.database.meals.get(meal.id)).resolves.toMatchObject({
			followsRecipe: true
		});
	});

	test('a checked-in meal of another member’s recipe, copied by an edit, exports without its pin', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(bobDevice);
		const meal = await planRecipeAsMeal(bobDevice.database, bobDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await bobDevice.sync();
		await aliceDevice.sync();
		const { checkIn } = await saveMealCheckIn(aliceDevice.database, aliceDevice.context, meal.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await updateMealHeader(aliceDevice.database, aliceDevice.context, meal.id, {
			title: 'Alice’s soup',
			description: null,
			cookTimeMinutes: null
		});
		await aliceDevice.database.households.put(familyKitchen);
		const archive = await decodePortableArchive(
			await exportPortableArchive(aliceDevice.database, alice.profileId)
		);

		const restored = await openDevice(alice);
		await restored.database.households.put(
			(await aliceDevice.database.households.get(householdId))!
		);
		await commitPortableImport(
			restored.database,
			await planPortableImport(restored.database, archive, alice.profileId)
		);

		expect(await titles(restored.database)).toEqual(new Map([[meal.id, 'Alice’s soup']]));
		await expect(restored.database.mealCheckIns.get(checkIn.id)).resolves.toMatchObject({
			verdict: 'repeat',
			recipeVersionId: null
		});
	});

	test('a recovery export keeps another member’s following meal as the copy it shows', async () => {
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(bobDevice);
		const meal = await planRecipeAsMeal(bobDevice.database, bobDevice.context, recipe.id, {
			date: '2099-01-01'
		});
		await bobDevice.sync();
		await aliceDevice.sync();
		await aliceDevice.database.households.put(familyKitchen);

		const recovery = await exportRecoveryArchives(aliceDevice.database);
		const archive = await decodePortableArchive(
			recovery.archives.find(({ workosUserId }) => workosUserId === alice.userId)!.blob
		);
		// Bob's recipe and versions stay out; the meal holds the content it showed.
		expect(archive.recipeVersions).toBeUndefined();
		const restored = await openDevice(alice);
		await restored.database.households.put(familyKitchen);
		await commitPortableImport(
			restored.database,
			await planPortableImport(restored.database, archive, alice.profileId)
		);

		expect(await titles(restored.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
	});

	test('importing with Keep local leaves a kept recipe’s meals on the local content', async () => {
		const device = await openDevice(alice);
		await device.database.households.put(familyKitchen);
		const recipe = await saveRecipe(device);
		const meal = await planRecipeAsMeal(device.database, device.context, recipe.id, {
			date: '2099-01-01'
		});
		const exportArchive = async () =>
			decodePortableArchive(await exportPortableArchive(device.database, alice.profileId));
		const before = await exportArchive();
		await editRecipe(device, recipe.id, 'Archived replacement');
		const after = await exportArchive();
		const local = await openDevice(alice);
		await local.database.households.put(familyKitchen);
		await commitPortableImport(
			local.database,
			await planPortableImport(local.database, before, alice.profileId)
		);

		const draft = await planPortableImport(local.database, after, alice.profileId);
		await commitPortableImport(
			local.database,
			await planPortableImport(
				local.database,
				after,
				alice.profileId,
				bulkResolutions(draft.collisions, 'keep-local')
			)
		);

		await expect(local.database.recipes.get(recipe.id)).resolves.toMatchObject({
			title: 'Sunday soup'
		});
		expect(await titles(local.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
	});

	test('on a shared device, a departed owner’s later edits stay out of the household', async () => {
		const on = (date: string) => `${date}T10:00:00.000Z` as `${string}Z`;
		// Free use: Alice and Bob share one database, and Bob stays in the household.
		const device = await openDevice(alice);
		await openDevice(bob, device.database);
		const recipe = await saveRecipe(device, on('2026-08-21'));
		const meal = await planRecipeAsMeal(
			device.database,
			{ ...device.context, occurredAt: on('2026-08-22') },
			recipe.id,
			{ date: '2099-01-01' }
		);
		await detachHouseholdSnapshot(device.database, {
			profileId: alice.profileId,
			householdId,
			denialCode: 'membership_revoked',
			detachedAt: on('2026-08-23')
		});

		await editRecipe(device, recipe.id, 'Private after leaving', on('2026-08-24'));

		expect(await titles(device.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
	});

	test('a detached snapshot copies its meals on detach, and a fork or export keeps them', async () => {
		const on = (date: string) => `${date}T10:00:00.000Z` as `${string}Z`;
		const device = await openDevice(alice);
		await device.database.households.put(familyKitchen);
		const recipe = await saveRecipe(device, on('2026-08-21'));
		const meal = await planRecipeAsMeal(
			device.database,
			{ ...device.context, occurredAt: on('2026-08-22') },
			recipe.id,
			{ date: '2099-01-01' }
		);
		const pending = await device.database.outbox.count();
		await detachHouseholdSnapshot(device.database, {
			profileId: alice.profileId,
			householdId,
			denialCode: 'membership_revoked',
			detachedAt: on('2026-08-23')
		});
		// Copied locally only: a snapshot never uploads.
		await expect(device.database.meals.get(meal.id)).resolves.toMatchObject({
			title: 'Sunday soup'
		});
		await expect(device.database.outbox.count()).resolves.toBe(pending);
		await editRecipe(device, recipe.id, 'Private after leaving', on('2026-08-24'));
		const titlesIn = async (database: MaalDatabase, id: string) =>
			(await listHouseholdMeals(database, id)).map(({ title }) => title);
		expect(await titlesIn(device.database, householdId)).toEqual(['Sunday soup']);
		const archive = await decodePortableArchive(
			await exportPortableArchive(device.database, alice.profileId)
		);

		const fork = await forkDetachedHouseholdSnapshot(device.database, {
			profileId: alice.profileId,
			householdId
		});
		expect(await titlesIn(device.database, fork.householdId)).toEqual(['Sunday soup']);

		// A fresh device without the original household restores it as a new local household.
		const restored = await openDevice(alice);
		await restored.database.memberships.clear();
		await commitPortableImport(
			restored.database,
			await planPortableImport(restored.database, archive, alice.profileId)
		);
		const [restoredMeal] = await restored.database.meals.toArray();
		expect(await titlesIn(restored.database, restoredMeal!.householdId as string)).toEqual([
			'Sunday soup'
		]);
	});

	test('removing a profile keeps the versions that the remaining household’s meals follow', async () => {
		const device = await openDevice(alice);
		await openDevice(bob, device.database);
		// Free use: nothing reaches D1, so this device holds the only copy.
		const followed = await saveRecipe(device);
		const unplanned = await commitImportedRecipeCandidate(
			device.database,
			device.recipeContext(),
			candidateFromToolRecipe({ title: 'Private soup' })
		);
		const meal = await planRecipeAsMeal(device.database, device.context, followed.id, {
			date: '2099-01-01'
		});

		const removed = await removeProfileFromDevice(device.database, alice.profileId);

		expect(removed.retainedHouseholdIds).toEqual([householdId]);
		expect(await titles(device.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		await expect(device.database.recipes.count()).resolves.toBe(0);
		await expect(
			device.database.recipeVersions.where('recipeId').equals(unplanned.id).count()
		).resolves.toBe(0);
	});
});
