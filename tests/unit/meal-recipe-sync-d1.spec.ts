import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import type { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { detachHouseholdSnapshot } from '$lib/client/local/households.js';
import { removeProfileFromDevice } from '$lib/client/local/profiles.js';
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
import {
	commitImportedRecipeCandidate,
	updateRecipeFromEditor
} from '$lib/client/recipes/index.js';
import { runRecipeVersionRetention } from '$lib/client/recipes/version-retention.js';
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
import { collectRecipeVersions } from '$lib/server/maintenance/recipe-versions.js';
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

	test('edits the owner makes after leaving stay private in every household read', async () => {
		const on = (date: string) => `${date}T10:00:00.000Z` as `${string}Z`;
		const aliceDevice = await openDevice(alice);
		const bobDevice = await openDevice(bob);
		const recipe = await saveRecipe(aliceDevice, on('2026-08-21'));
		const meal = await planRecipeAsMeal(
			aliceDevice.database,
			{ ...aliceDevice.context, occurredAt: on('2026-08-22') },
			recipe.id,
			{ date: '2099-01-01' }
		);
		await aliceDevice.sync();
		await bobDevice.sync();

		await d1
			.prepare(
				`UPDATE household_memberships SET status = 'revoked', updated_at = ?
				 WHERE workos_user_id = ?`
			)
			.bind(on('2026-08-23'), alice.userId)
			.run();
		await editRecipe(aliceDevice, recipe.id, 'Private after leaving', on('2026-08-24'));
		await aliceDevice.syncUser();
		await bobDevice.sync();

		const port = new D1RemoteDomainPort(d1, MCP_TEST_DEVICE);
		expect(await titles(bobDevice.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		await expect(port.getHouseholdMeal(householdId, meal.id)).resolves.toMatchObject({
			title: 'Sunday soup'
		});
		expect((await port.listHouseholdMeals(householdId)).map(({ title }) => title)).toEqual([
			'Sunday soup'
		]);
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

describe('version collection', () => {
	/** Alice's recipe edited monthly, a meal that needs February, and one that pinned March. */
	const seedHistory = async () => {
		const aliceDevice = await openDevice(alice);
		const on = (date: string) => `${date}T10:00:00.000Z` as `${string}Z`;
		const recipe = await saveRecipe(aliceDevice, on('2026-01-01'));
		await editRecipe(aliceDevice, recipe.id, 'February soup', on('2026-02-01'));
		const february = await planRecipeAsMeal(
			aliceDevice.database,
			{ ...aliceDevice.context, occurredAt: on('2026-02-02') },
			recipe.id,
			{ date: '2026-02-15' }
		);
		await editRecipe(aliceDevice, recipe.id, 'March soup', on('2026-03-01'));
		const pinned = await planRecipeAsMeal(
			aliceDevice.database,
			{ ...aliceDevice.context, occurredAt: on('2026-03-02') },
			recipe.id,
			{ date: '2026-04-20' }
		);
		await saveMealCheckIn(
			aliceDevice.database,
			{ ...aliceDevice.context, occurredAt: on('2026-03-05') },
			pinned.id,
			{ status: 'cooked', verdict: 'repeat' }
		);
		await editRecipe(aliceDevice, recipe.id, 'April soup', on('2026-04-01'));
		await editRecipe(aliceDevice, recipe.id, 'May soup', on('2026-05-01'));
		await editRecipe(aliceDevice, recipe.id, 'August soup', on('2026-08-01'));
		await aliceDevice.sync();
		return { aliceDevice, recipe, february, pinned };
	};
	const now = '2026-08-20T00:00:00.000Z';
	const versionTitles = async (database: MaalDatabase) =>
		(await database.recipeVersions.toArray())
			.map(({ recipe }) => (recipe as { title: string }).title)
			.toSorted();

	test('keeps every version a meal or check-in needs, drops the rest, and every device follows', async () => {
		const { aliceDevice, february, pinned } = await seedHistory();
		const bobDevice = await openDevice(bob);
		await bobDevice.sync();

		await expect(collectRecipeVersions(d1, now)).resolves.toBe(2);
		await aliceDevice.sync();
		await bobDevice.sync();

		// January and April went; May stays because August took effect within 90 days.
		const kept = ['August soup', 'February soup', 'March soup', 'May soup'];
		expect(await versionTitles(aliceDevice.database)).toEqual(kept);
		expect(await versionTitles(bobDevice.database)).toEqual(kept);
		const expected = new Map([
			[february.id, 'February soup'],
			[pinned.id, 'March soup']
		]);
		expect(await titles(aliceDevice.database)).toEqual(expected);
		expect(await titles(bobDevice.database)).toEqual(expected);
	});

	test('a meal synced while collection runs keeps the version it needs', async () => {
		const { recipe } = await seedHistory();
		const bobsMeal = planRecipeFollowingMeal({
			recipe,
			householdId,
			mealId: uuidv7(),
			occurredAt: new Date().toISOString(),
			options: { date: '2026-04-10' }
		});
		const racing = beforeNextBatch(() => pushMeal(bob.userId, bobsMeal));

		await expect(collectRecipeVersions(racing, now)).resolves.toBe(0);
		await expect(collectRecipeVersions(d1, now)).resolves.toBe(1);

		const bobDevice = await openDevice(bob);
		await bobDevice.sync();
		expect((await titles(bobDevice.database)).get(bobsMeal.id)).toBe('April soup');
	});

	test('a device keeps the version a detached household’s meal shows', async () => {
		// Free use: Alice's user scope never syncs, so this device collects her versions itself.
		const device = await openDevice(alice);
		const on = (date: string) => `${date}T10:00:00.000Z` as `${string}Z`;
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
		await editRecipe(device, recipe.id, 'August soup', on('2026-08-24'));
		await editRecipe(device, recipe.id, 'September soup', on('2026-09-01'));

		await runRecipeVersionRetention(device.database, new Date('2027-03-01T00:00:00.000Z'));

		expect(await titles(device.database)).toEqual(new Map([[meal.id, 'Sunday soup']]));
		expect(await versionTitles(device.database)).toEqual(['September soup', 'Sunday soup']);
	});
});

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
