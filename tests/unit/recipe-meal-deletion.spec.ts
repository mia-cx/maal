import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import { MaalDatabase, openMaalDatabase } from '$lib/client/local/database.js';
import {
	deleteMeal,
	listHouseholdMeals,
	planRecipeAsMeal,
	runMealRetention,
	saveMealCheckIn,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { collectPortableArchive } from '$lib/client/portability/archive.js';
import {
	createRecipeAndPlanMeal,
	createRecipeFromEditor,
	deleteRecipe,
	permanentlyDeleteRecipe,
	restoreRecipe,
	runRecipeRetention,
	type RecipeCommandContext,
	type RecipeEditorPatch
} from '$lib/client/recipes/index.js';
import { MealCheckInSchema, StoredMealSchema, isMealAggregate } from '$lib/domain/meals/schema.js';
import { StoredRecipeSchema, isRecipeAggregate } from '$lib/domain/recipes/schema.js';

const databases: MaalDatabase[] = [];
const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`deletion-${crypto.randomUUID()}`);
	databases.push(database);
	await database.memberships.put({
		membershipId: 'membership_alice',
		householdId: 'org_family',
		workosUserId: 'user_alice',
		roleSlug: 'admin',
		permissions: ['meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: at(1),
		lastVerifiedAt: at(1),
		updatedAt: at(1),
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
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

const at = (day: number): `${string}Z` => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const deviceId = uuidv7();
const recipeContext = (occurredAt = at(20)): RecipeCommandContext => ({
	authSlotId: 'slot-alice',
	ownerUserId: 'user_alice',
	originDeviceId: deviceId,
	occurredAt
});
const mealContext = (occurredAt = at(21)): MealCommandContext => ({
	authSlotId: 'slot-alice',
	householdId: 'org_family',
	reporterUserId: 'user_alice',
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
	ingredients: [{ id: null, amount: '2', unit: 'cups', item: 'rice' }],
	instructions: [{ id: null, position: 1, text: 'Boil.' }]
});

const enableHouseholdSync = (database: MaalDatabase) =>
	database.billingCapabilities.put({
		householdId: 'org_family',
		state: 'enabled',
		stripeStatus: 'active',
		subscriberUserId: 'user_alice',
		stripePriceId: 'price_test',
		currentPeriodEnd: '2027-12-01T00:00:00.000Z',
		interruptionStartedAt: null,
		graceUntil: null,
		validUntil: '2027-12-01T00:00:00.000Z',
		cancelAtPeriodEnd: false,
		stale: false,
		source: 'stripe-d1'
	});

const failMealWrites = (database: MaalDatabase) => {
	const fail = () => {
		throw new Error('meal write failed');
	};
	database.meals.hook('creating', fail);
	database.meals.hook('updating', fail);
};

const storedMeal = async (database: MaalDatabase, id: string) =>
	Schema.decodeUnknownSync(StoredMealSchema)(await database.meals.get(id));
const storedRecipe = async (database: MaalDatabase, id: string) =>
	Schema.decodeUnknownSync(StoredRecipeSchema)(await database.recipes.get(id));

describe('recipe deletion and meal provenance', () => {
	test('recoverable delete and restore keep meal provenance', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Stew'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });

		await deleteRecipe(database, recipeContext(at(22)), recipe.id);
		await restoreRecipe(database, recipeContext(at(23)), recipe.id);

		const [after] = await listHouseholdMeals(database, 'org_family');
		expect(after?.id).toBe(meal.id);
		expect(after?.sourceRecipeId).toBe(recipe.id);
	});

	test('permanent delete purges and detaches live meals when a linked meal is already deleted', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const kept = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		const removed = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23'
		});
		await deleteMeal(database, mealContext(at(22)), removed.id);
		await deleteRecipe(database, recipeContext(at(23)), recipe.id);

		await permanentlyDeleteRecipe(database, recipeContext(at(24)), recipe.id);

		expect(isRecipeAggregate(await storedRecipe(database, recipe.id))).toBe(false);
		const [live] = await listHouseholdMeals(database, 'org_family');
		expect(live).toMatchObject({ id: kept.id, sourceRecipeId: null, title: 'Soup' });
		const purgeRows = await database.outbox
			.filter(({ occurredAt }) => occurredAt === at(24))
			.toArray();
		expect(
			purgeRows.map(({ scopeKind, entityKind, aggregateId }) => ({
				scopeKind,
				entityKind,
				aggregateId
			}))
		).toEqual([
			{ scopeKind: 'user', entityKind: 'recipe', aggregateId: recipe.id },
			{ scopeKind: 'household', entityKind: 'meal', aggregateId: kept.id }
		]);
	});

	test('permanent delete commits nothing when detaching a meal fails', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Dal'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		const outboxBefore = await database.outbox.count();
		failMealWrites(database);

		await expect(
			permanentlyDeleteRecipe(database, recipeContext(at(24)), recipe.id)
		).rejects.toBeTruthy();

		expect(isRecipeAggregate(await storedRecipe(database, recipe.id))).toBe(true);
		expect(await storedMeal(database, meal.id)).toMatchObject({ sourceRecipeId: recipe.id });
		expect(await database.outbox.count()).toBe(outboxBefore);
	});

	test('retention purge of an expired recipe detaches its meals', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Curry'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		await deleteRecipe(database, recipeContext('2026-08-22T00:00:00.000Z'), recipe.id);

		const result = await runRecipeRetention(
			database,
			recipeContext('2026-09-30T00:00:00.000Z'),
			'2026-09-30T00:00:00.000Z'
		);

		expect(result.purgedRecipeIds).toEqual([recipe.id]);
		expect(await storedMeal(database, meal.id)).toMatchObject({ sourceRecipeId: null });
	});
});

describe('deletion boundaries', () => {
	test('permanent delete leaves detached household snapshots untouched', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const snapshotMeal = await planRecipeAsMeal(
			database,
			{ ...mealContext(), householdId: 'org_former' },
			recipe.id,
			{ date: '2026-08-22' }
		);
		await database.memberships.put({
			...(await database.memberships.get('membership_alice'))!,
			membershipId: 'membership_former',
			householdId: 'org_former',
			status: 'detached',
			detachedAt: at(21)
		});

		await permanentlyDeleteRecipe(database, recipeContext(at(24)), recipe.id);

		expect(await storedMeal(database, snapshotMeal.id)).toMatchObject({
			sourceRecipeId: recipe.id
		});
		expect(
			await database.outbox
				.filter(({ scopeId, occurredAt }) => scopeId === 'org_former' && occurredAt === at(24))
				.count()
		).toBe(0);
	});

	test("deleting a meal queues an outbox row for the deleter's own check-in only", async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		const verdict = { status: 'cooked', verdict: 'repeat' } as const;
		const own = await saveMealCheckIn(database, mealContext(at(22)), meal.id, verdict);
		const bobs = await saveMealCheckIn(
			database,
			{ ...mealContext(at(22)), authSlotId: 'slot-bob', reporterUserId: 'user_bob' },
			meal.id,
			verdict
		);

		await deleteMeal(database, mealContext(at(23)), meal.id);

		const rows = (
			await database.outbox.filter(({ occurredAt }) => occurredAt === at(23)).toArray()
		).toSorted((left, right) => left.entityKind.localeCompare(right.entityKind));
		expect(rows.map(({ entityKind, aggregateId }) => ({ entityKind, aggregateId }))).toEqual([
			{ entityKind: 'meal', aggregateId: meal.id },
			{ entityKind: 'meal_check_in', aggregateId: own.checkIn.id }
		]);
		const ownAfter = Schema.decodeUnknownSync(MealCheckInSchema)(
			await database.mealCheckIns.get(own.checkIn.id)
		);
		expect(ownAfter.mealId).toBeNull();
		expect(ownAfter.conflictClocks.response?.mutationId).toBe(rows[1]?.mutationId);
		const bobsAfter = Schema.decodeUnknownSync(MealCheckInSchema)(
			await database.mealCheckIns.get(bobs.checkIn.id)
		);
		expect(bobsAfter.mealId).toBeNull();
		expect(bobsAfter.conflictClocks.response).toEqual(bobs.checkIn.conflictClocks.response);
	});

	test('a deleted meal still awaiting acknowledgement is left out of the export', async () => {
		const database = await openDatabase();
		await enableHouseholdSync(database);
		await database.profiles.put({
			profileId: 'profile_alice',
			workosUserId: 'user_alice',
			displayName: 'Alice',
			email: 'alice@example.test',
			profilePictureUrl: null,
			locale: 'en-US',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: at(1),
			authState: 'authenticated'
		});
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const kept = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		const removed = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23'
		});
		await deleteMeal(database, mealContext(at(22)), removed.id);

		const archive = await collectPortableArchive(database, 'profile_alice');

		expect(archive.meals.meals.map(({ id }) => id)).toEqual([kept.id]);
	});
});

describe('create recipe and plan meal', () => {
	test('creates the recipe and its planned meal in one gesture', async () => {
		const database = await openDatabase();

		const { recipe, meal } = await createRecipeAndPlanMeal(
			database,
			mealContext(at(21)),
			patch('Rice'),
			{ date: '2026-08-22', plannedYield: 3 }
		);

		expect(meal).toMatchObject({
			sourceRecipeId: recipe.id,
			title: 'Rice',
			date: '2026-08-22',
			plannedYield: 3
		});
		expect(
			(await database.outbox.toArray()).map(({ scopeKind, scopeId, entityKind }) => ({
				scopeKind,
				scopeId,
				entityKind
			}))
		).toEqual([
			{ scopeKind: 'user', scopeId: 'user_alice', entityKind: 'recipe' },
			{ scopeKind: 'household', scopeId: 'org_family', entityKind: 'meal' }
		]);
	});

	test('leaves no recipe behind when planning the meal fails', async () => {
		const database = await openDatabase();
		failMealWrites(database);

		await expect(
			createRecipeAndPlanMeal(database, mealContext(), patch('Rice'), { date: '2026-08-22' })
		).rejects.toBeTruthy();

		expect(await database.recipes.count()).toBe(0);
		expect(await database.outbox.count()).toBe(0);
	});
});

describe('deleted meal content retention', () => {
	test('removes content at once when the household does not sync', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });

		await deleteMeal(database, mealContext(at(22)), meal.id);

		const stored = await storedMeal(database, meal.id);
		expect(isMealAggregate(stored)).toBe(false);
		expect(stored).toMatchObject({
			id: meal.id,
			householdId: 'org_family',
			deletedAt: at(22),
			purgedAt: at(22),
			retainUntil: '2027-08-22T10:00:00.000Z'
		});
		expect(await listHouseholdMeals(database, 'org_family')).toEqual([]);
	});

	test('keeps synced content until the deletion is acknowledged, then expires the tombstone after a year', async () => {
		const database = await openDatabase();
		await enableHouseholdSync(database);
		const recipe = await createRecipeFromEditor(database, recipeContext(), patch('Soup'));
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-22' });
		await deleteMeal(database, mealContext(at(22)), meal.id);

		const pending = await runMealRetention(database, at(23));
		expect(pending.purgedMealIds).toEqual([]);
		expect(await storedMeal(database, meal.id)).toMatchObject({ title: 'Soup' });

		await database.outbox.where('aggregateId').equals(meal.id).modify({ status: 'acknowledged' });
		const acknowledged = await runMealRetention(database, at(24));
		expect(acknowledged.purgedMealIds).toEqual([meal.id]);
		const tombstone = await storedMeal(database, meal.id);
		expect(isMealAggregate(tombstone)).toBe(false);
		expect(tombstone).toMatchObject({ purgedAt: at(24), retainUntil: '2027-08-24T10:00:00.000Z' });

		const early = await runMealRetention(database, '2027-08-23T10:00:00.000Z');
		expect(early.expiredTombstoneIds).toEqual([]);
		const expired = await runMealRetention(database, '2027-08-24T10:00:00.000Z');
		expect(expired.expiredTombstoneIds).toEqual([meal.id]);
		expect(await database.meals.get(meal.id)).toBeUndefined();
	});
});
