import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import {
	openMaalDatabase,
	type LocalStoreName,
	type MaalDatabase
} from '$lib/client/local/database.js';
import { exportRecoveryArchives } from '$lib/client/local/recovery-export.js';
import { planRecipeAsMeal, saveMealCheckIn } from '$lib/client/meals/index.js';
import {
	commitPortableImport,
	decodePortableArchive,
	planPortableImport
} from '$lib/client/portability/index.js';
import { createRecipeFromEditor } from '$lib/client/recipes/index.js';
import type { PortableArchive } from '$lib/domain/portability/schema.js';

const databases: MaalDatabase[] = [];
const at = '2026-08-21T10:00:00.000Z' as const;
const metadata = {
	schemaVersion: 1 as const,
	revision: 1,
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
	conflictClocks: {}
};
const userId = 'user_alice';
const householdId = 'org_family';

const openDatabase = async () => {
	const database = await openMaalDatabase(`recovery-archives-${crypto.randomUUID()}`);
	databases.push(database);
	return database;
};

afterEach(async () => {
	for (const database of databases) {
		database.close();
		await Dexie.delete(database.name);
	}
	databases.length = 0;
});

const seedProfile = async (database: MaalDatabase, workosUserId = userId) => {
	const profileId = uuidv7();
	await database.profiles.put({
		profileId,
		workosUserId,
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-US',
		timezone: 'Europe/Amsterdam',
		pinSalt: 'secret-salt',
		pinVerifier: 'secret-verifier',
		lockPolicy: 'pin',
		lastUsedAt: at,
		authState: 'authenticated'
	});
	return profileId;
};

const seedContent = async (database: MaalDatabase) => {
	const profileId = await seedProfile(database);
	await database.households.put({
		...metadata,
		householdId,
		name: 'Family kitchen',
		locale: 'en-US',
		timezone: 'Europe/Amsterdam',
		weekStartsOn: 1,
		defaultPlannedYield: 4,
		preferredDinnerTime: '18:00',
		createdByUserId: userId,
		deletionState: 'active',
		localOnly: false
	});
	await database.memberships.put({
		membershipId: uuidv7(),
		householdId,
		workosUserId: userId,
		roleSlug: 'admin',
		permissions: ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: at,
		lastVerifiedAt: at,
		updatedAt: at,
		detachedAt: null,
		denialCode: null,
		source: 'workos'
	});
	await database.householdAppliances.put({
		...metadata,
		id: uuidv7(),
		householdId,
		appliance: 'stovetop',
		available: true,
		notes: null
	});
	const recipe = await createRecipeFromEditor(
		database,
		{
			authSlotId: 'slot-alice',
			ownerUserId: userId,
			originDeviceId: uuidv7(),
			occurredAt: at
		},
		{
			title: 'Readable soup',
			description: 'Keep the text',
			imageUrl: null,
			sourceUrl: null,
			sourceSiteName: null,
			sourceAuthorName: null,
			sourcePublisherName: null,
			sourceIsBasedOnUrl: null,
			prepTimeMinutes: 5,
			cookTimeMinutes: 20,
			yield: 4,
			ingredients: [{ id: null, amount: '1', unit: 'cup', item: 'water' }],
			instructions: [{ id: null, position: 1, text: 'Simmer gently.' }]
		}
	);
	const ingredients = recipe.ingredients.map((row) => ({
		...row,
		baseUnitId: 'cups',
		baseUnitFamilyId: 'milliliters',
		baseQuantity: 236.5882365
	}));
	await database.recipes.update(recipe.id, { savedFromHouseholdId: householdId, ingredients });
	const context = {
		authSlotId: 'slot-alice',
		householdId,
		reporterUserId: userId,
		originDeviceId: uuidv7(),
		occurredAt: at
	};
	const meal = await planRecipeAsMeal(database, context, recipe.id, { date: '2026-08-22' });
	await saveMealCheckIn(database, context, meal.id, {
		status: 'cooked',
		verdict: 'repeat',
		cookTimeMinutes: 20,
		reason: 'Keep the verdict'
	});
	return { profileId, recipe: { ...recipe, ingredients }, meal };
};

const restoreFresh = async (archive: PortableArchive, workosUserId = userId) => {
	const target = await openDatabase();
	const profileId = await seedProfile(target, workosUserId);
	const plan = await planPortableImport(target, archive, profileId);
	expect(plan.unresolvedCollisionIds).toEqual([]);
	await commitPortableImport(target, plan);
	return target;
};

const unreadableStore = (source: MaalDatabase, store: LocalStoreName) => ({
	name: source.name,
	table: <T, TKey, TInsertType = T>(name: string) => {
		if (name === store) throw new Error(`Unreadable ${store}`);
		return source.table<T, TKey, TInsertType>(name);
	}
});

describe('recovery archive reference closure', () => {
	test('repairs optional dependencies, prunes required dependencies, and retains readable content', async () => {
		const source = await openDatabase();
		const { recipe, meal } = await seedContent(source);
		const missingFood = uuidv7();
		const missingUnit = uuidv7();
		const orphanUnit = uuidv7();
		const goodFood = uuidv7();
		const foodAlias = uuidv7();
		const missingAlias = uuidv7();
		await source.foodUserEntries.put({
			...metadata,
			id: missingFood,
			workosUserId: userId,
			canonicalLabel: 'damaged',
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null,
			adoptionStatus: 'accepted'
		});
		await source.foodUserEntries.update(missingFood, { canonicalLabel: '' });
		await source.unitUserEntries.put({
			...metadata,
			id: missingUnit,
			workosUserId: userId,
			canonicalLabel: 'damaged',
			baseUnitId: 'grams',
			toBaseFactor: 1,
			toBaseOffset: 0,
			adoptionStatus: 'accepted'
		});
		await source.unitUserEntries.update(missingUnit, { toBaseFactor: NaN });
		await source.unitUserEntries.put({
			...metadata,
			id: orphanUnit,
			workosUserId: userId,
			canonicalLabel: 'orphan',
			baseUnitId: missingUnit,
			toBaseFactor: 1,
			toBaseOffset: 0,
			adoptionStatus: 'accepted'
		});
		await source.foodUserEntries.put({
			...metadata,
			id: goodFood,
			workosUserId: userId,
			canonicalLabel: 'Readable food',
			defaultMeasureUnitId: orphanUnit,
			defaultMeasureBaseUnitId: 'grams',
			adoptionStatus: 'accepted'
		});
		await source.foodUserAliases.bulkPut([
			{
				...metadata,
				id: foodAlias,
				workosUserId: userId,
				foodId: goodFood,
				alias: 'Readable alias',
				locale: 'en-US',
				sourceDomain: null,
				adoptionStatus: 'accepted',
				defaultMeasureUnitId: missingUnit,
				defaultMeasureBaseUnitId: 'grams'
			},
			{
				...metadata,
				id: missingAlias,
				workosUserId: userId,
				foodId: missingFood,
				alias: 'Dangling alias',
				locale: 'en-US',
				sourceDomain: null,
				adoptionStatus: 'accepted',
				defaultMeasureUnitId: null,
				defaultMeasureBaseUnitId: null
			}
		]);
		await source.unitUserAliases.put({
			...metadata,
			id: uuidv7(),
			workosUserId: userId,
			unitId: orphanUnit,
			baseUnitId: 'grams',
			alias: 'Dangling unit',
			pluralAlias: null,
			locale: 'en-US',
			sourceDomain: null,
			adoptionStatus: 'accepted'
		});
		await source.userFoodPreferences.bulkPut([
			{
				...metadata,
				id: uuidv7(),
				workosUserId: userId,
				foodId: missingFood,
				preference: 'like',
				reason: null
			},
			{
				...metadata,
				id: uuidv7(),
				workosUserId: userId,
				foodId: goodFood,
				preference: 'like',
				reason: 'Keep this'
			}
		]);
		await source.userFoodDisplayPreferences.put({
			...metadata,
			id: uuidv7(),
			workosUserId: userId,
			foodId: goodFood,
			locale: 'en-US',
			preferredFoodAliasScope: 'user',
			preferredFoodAliasId: missingAlias,
			preferredMeasureUnitId: missingUnit,
			preferredMeasureBaseUnitId: 'grams'
		});
		await source.userUnitDisplayPreferences.bulkPut([
			{
				...metadata,
				id: uuidv7(),
				workosUserId: userId,
				baseUnitId: 'grams',
				locale: 'en-US',
				preferredUnitId: orphanUnit,
				preferredUnitAliasId: null,
				preferredUnitAliasScope: null
			},
			{
				...metadata,
				id: uuidv7(),
				workosUserId: userId,
				baseUnitId: 'milliliters',
				locale: 'en-US',
				preferredUnitId: 'cups',
				preferredUnitAliasId: uuidv7(),
				preferredUnitAliasScope: 'user'
			}
		]);
		const ingredients = recipe.ingredients.map((row) => ({
			...row,
			baseFoodId: missingFood,
			baseUnitId: orphanUnit,
			baseUnitFamilyId: 'grams',
			baseQuantity: 10
		}));
		await source.recipes.update(recipe.id, { ingredients, deletedAt: at });
		await source.meals.update(meal.id, { ingredients, sourceRecipeId: uuidv7() });
		const recovery = await exportRecoveryArchives(source);
		expect(recovery.skipped).toEqual({
			foodUserEntries: 1,
			unitUserEntries: 2,
			foodUserAliases: 1,
			unitUserAliases: 1,
			userFoodPreferences: 1,
			userUnitDisplayPreferences: 1
		});
		expect(recovery.repaired).toEqual({
			foodUserEntries: 1,
			foodUserAliases: 1,
			userFoodDisplayPreferences: 1,
			userUnitDisplayPreferences: 1,
			recipes: 1,
			meals: 1
		});
		const archive = await decodePortableArchive(recovery.archives[0]!.blob);
		expect(JSON.stringify(archive)).not.toContain('secret-');
		expect(archive.deletedRecipes?.recipes[0]?.ingredients[0]).toMatchObject({
			originalText: recipe.ingredients[0]!.originalText,
			baseFoodId: null,
			baseUnitId: null,
			baseUnitFamilyId: null,
			baseQuantity: null
		});
		expect(archive.taxonomy.foodUserEntries[0]).toMatchObject({
			id: goodFood,
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null
		});
		expect(archive.preferences.userFoodDisplayPreferences[0]).toMatchObject({
			preferredFoodAliasId: null,
			preferredFoodAliasScope: null,
			preferredMeasureUnitId: null,
			preferredMeasureBaseUnitId: null
		});
		expect(archive.preferences.userUnitDisplayPreferences[0]).toMatchObject({
			preferredUnitId: 'cups',
			preferredUnitAliasId: null,
			preferredUnitAliasScope: null
		});
		const target = await restoreFresh(archive);
		await expect(target.recipes.get(recipe.id)).resolves.toMatchObject({
			title: 'Readable soup',
			deletedAt: at
		});
		await expect(target.meals.count()).resolves.toBe(1);
		await expect(target.mealCheckIns.count()).resolves.toBe(1);
		await expect(target.foodUserEntries.count()).resolves.toBe(1);
		await expect(target.unitUserEntries.count()).resolves.toBe(0);
	});

	test.each(['households', 'meals', 'units', 'foodUserEntries', 'unitUserEntries'] as const)(
		'restores archives when %s is unreadable',
		async (store) => {
			const source = await openDatabase();
			const { recipe } = await seedContent(source);
			const foodId = uuidv7();
			const unitId = uuidv7();
			await source.unitUserEntries.put({
				...metadata,
				id: unitId,
				workosUserId: userId,
				canonicalLabel: 'Readable unit',
				baseUnitId: 'grams',
				toBaseFactor: 1,
				toBaseOffset: 0,
				adoptionStatus: 'accepted'
			});
			await source.foodUserEntries.put({
				...metadata,
				id: foodId,
				workosUserId: userId,
				canonicalLabel: 'Readable food',
				defaultMeasureUnitId: unitId,
				defaultMeasureBaseUnitId: 'grams',
				adoptionStatus: 'accepted'
			});
			await source.userFoodPreferences.put({
				...metadata,
				id: uuidv7(),
				workosUserId: userId,
				foodId,
				preference: 'like',
				reason: null
			});
			const recovery = await exportRecoveryArchives(unreadableStore(source, store));
			expect(recovery.unreadable).toEqual([store]);
			const archive = await decodePortableArchive(recovery.archives[0]!.blob);
			if (store === 'units') {
				expect(archive.recipes.recipes[0]?.ingredients[0]?.baseUnitId).toBe('cups');
				expect(recovery.skipped.recipes).toBeUndefined();
				expect(recovery.repaired.recipes).toBeUndefined();
			}
			if (store === 'households') {
				expect(recovery.skipped).toEqual({
					memberships: 1,
					householdAppliances: 1,
					meals: 1
				});
				expect(recovery.repaired).toEqual({
					recipes: 1,
					mealCheckIns: 1
				});
				expect(archive.recipes.recipes[0]?.savedFromHouseholdId).toBeNull();
			}
			if (store === 'meals') {
				expect(recovery.skipped).toEqual({});
				expect(recovery.repaired).toEqual({ mealCheckIns: 1 });
			}
			if (store === 'foodUserEntries') expect(recovery.skipped.userFoodPreferences).toBe(1);
			if (store === 'unitUserEntries') {
				expect(recovery.skipped).toEqual({});
				expect(recovery.repaired).toEqual({ foodUserEntries: 1 });
				expect(archive.taxonomy.foodUserEntries[0]).toMatchObject({
					defaultMeasureUnitId: null,
					defaultMeasureBaseUnitId: null
				});
			}
			const target = await restoreFresh(archive);
			await expect(target.recipes.get(recipe.id)).resolves.toMatchObject({
				title: 'Readable soup'
			});
			await expect(target.meals.count()).resolves.toBe(
				store === 'households' || store === 'meals' ? 0 : 1
			);
			await expect(target.mealCheckIns.count()).resolves.toBe(1);
		}
	);

	test('discovers a recipe-less user from user-scoped rows, not cached household members', async () => {
		const source = await openDatabase();
		const { profileId, recipe, meal } = await seedContent(source);
		await source.recipes.delete(recipe.id);
		await source.profiles.delete(profileId);
		await source.userAttributions.bulkPut([
			{ workosUserId: userId, displayName: 'Recovered Alice', profilePictureUrl: null },
			{ workosUserId: 'user_remote', displayName: 'Other member', profilePictureUrl: null }
		]);
		await source.meals.update(meal.id, { plannedCookUserId: 'user_remote' });
		const membership = (await source.memberships.toArray())[0]!;
		await source.memberships.put({
			...membership,
			membershipId: uuidv7(),
			workosUserId: 'user_remote'
		});
		await source.mealCheckIns.put({
			...metadata,
			id: uuidv7(),
			reporterUserId: 'user_remote',
			mealId: null,
			verdict: 'neutral',
			cookTimeMinutes: null,
			reason: null
		});
		await source.userUnitDisplayPreferences.put({
			...metadata,
			id: uuidv7(),
			workosUserId: userId,
			baseUnitId: 'grams',
			locale: 'en-US',
			preferredUnitId: 'grams',
			preferredUnitAliasScope: null,
			preferredUnitAliasId: null
		});
		const recovery = await exportRecoveryArchives(source);
		expect(recovery.skipped).toEqual({});
		expect(recovery.repaired).toEqual({});
		expect(recovery.archives.map((row) => [row.workosUserId, row.displayName])).toEqual([
			[userId, 'Recovered Alice']
		]);
		const archive = await decodePortableArchive(recovery.archives[0]!.blob);
		expect(archive.users.users.find((row) => row.workosUserId === 'user_remote')).toMatchObject({
			displayName: 'Other member'
		});
		const target = await restoreFresh(archive);
		await expect(target.recipes.count()).resolves.toBe(0);
		await expect(target.meals.count()).resolves.toBe(1);
		await expect(target.userUnitDisplayPreferences.count()).resolves.toBe(1);
	});

	test.each([true, false])(
		'recovers household-only data with damaged profile attribution (cached: %s)',
		async (withCachedAttribution) => {
			const source = await openDatabase();
			const { profileId, recipe } = await seedContent(source);
			await source.recipes.delete(recipe.id);
			await source.profiles.update(profileId, { displayName: '' });
			if (withCachedAttribution) {
				await source.userAttributions.put({
					workosUserId: userId,
					displayName: 'Recovered Alice',
					profilePictureUrl: null
				});
			}
			await expect(source.userFoodPreferences.count()).resolves.toBe(0);
			await expect(source.userUnitDisplayPreferences.count()).resolves.toBe(0);
			const recovery = await exportRecoveryArchives(source);
			expect(recovery.skipped).toEqual({});
			expect(recovery.repaired).toEqual({ profiles: 1 });
			expect(recovery.archives.map((row) => [row.workosUserId, row.displayName])).toEqual([
				[userId, withCachedAttribution ? 'Recovered Alice' : userId]
			]);
			const archive = await decodePortableArchive(recovery.archives[0]!.blob);
			expect(archive.recipes.recipes).toEqual([]);
			expect(archive.meals.meals).toHaveLength(1);
			expect(archive.checkIns.checkIns).toHaveLength(1);
			const encoded = JSON.stringify(archive);
			expect(encoded).not.toContain('secret-');
			expect(encoded).not.toContain('pinSalt');
			expect(encoded).not.toContain('pinVerifier');
			expect(encoded).not.toContain('alice@example.test');
			expect(encoded).not.toContain('email');
			const target = await restoreFresh(archive);
			await expect(target.recipes.count()).resolves.toBe(0);
			await expect(target.meals.count()).resolves.toBe(1);
			await expect(target.mealCheckIns.toArray()).resolves.toEqual([
				expect.objectContaining({ reporterUserId: userId, verdict: 'repeat' })
			]);
			await expect(source.profiles.get(profileId)).resolves.toMatchObject({
				displayName: '',
				pinVerifier: 'secret-verifier'
			});
		}
	);

	test.each([null, undefined])(
		'keeps the startup skipped count when a damaged profile has user ID %s',
		async (workosUserId) => {
			const source = await openDatabase();
			await source.table('profiles').put({
				profileId: uuidv7(),
				...(workosUserId === undefined ? {} : { workosUserId }),
				pinSalt: 'secret-salt',
				pinVerifier: 'secret-verifier'
			});
			await source.table('recipes').bulkPut([
				{
					...metadata,
					id: uuidv7(),
					ownerUserId: userId,
					purgedAt: at,
					retainUntil: '2027-08-21T10:00:00.000Z',
					purgeReason: 'permanent_delete',
					searchTokens: []
				},
				{ id: uuidv7(), title: 42 }
			]);
			const recovery = await exportRecoveryArchives(source);
			expect(recovery.skipped).toEqual({ profiles: 1, recipes: 1 });
			expect(recovery.repaired).toEqual({});
			expect(recovery.archives.map((row) => row.workosUserId)).toEqual([userId]);
			const archive = await decodePortableArchive(recovery.archives[0]!.blob);
			expect(JSON.stringify(archive)).not.toContain('secret-');
			const target = await restoreFresh(archive);
			await expect(target.recipes.count()).resolves.toBe(0);
		}
	);

	test('orders readable custom unit dependencies for a different importing user', async () => {
		const source = await openDatabase();
		await seedProfile(source);
		const childId = uuidv7();
		const baseId = uuidv7();
		await source.unitUserEntries.bulkPut([
			{
				...metadata,
				id: childId,
				workosUserId: userId,
				canonicalLabel: 'Child unit',
				baseUnitId: baseId,
				toBaseFactor: 2,
				toBaseOffset: 0,
				adoptionStatus: 'accepted'
			},
			{
				...metadata,
				id: baseId,
				workosUserId: userId,
				canonicalLabel: 'Base unit',
				baseUnitId: 'grams',
				toBaseFactor: 1,
				toBaseOffset: 0,
				adoptionStatus: 'accepted'
			}
		]);
		const recovery = await exportRecoveryArchives(source);
		expect(recovery.skipped).toEqual({});
		expect(recovery.repaired).toEqual({});
		const archive = await decodePortableArchive(recovery.archives[0]!.blob);
		expect(archive.taxonomy.unitUserEntries.map((row) => row.id)).toEqual([baseId, childId]);
		const target = await restoreFresh(archive, 'user_bob');
		const units = await target.unitUserEntries.toArray();
		const base = units.find((row) => row.canonicalLabel === 'Base unit');
		expect(base?.id).not.toBe(baseId);
		expect(units.find((row) => row.canonicalLabel === 'Child unit')).toMatchObject({
			workosUserId: 'user_bob',
			baseUnitId: base?.id
		});
	});

	test('resolves dependencies per exporter and counts shared repairs once', async () => {
		const source = await openDatabase();
		const { recipe, meal } = await seedContent(source);
		const otherId = 'user_bob';
		await seedProfile(source, otherId);
		const membership = (await source.memberships.toArray())[0]!;
		await source.memberships.put({ ...membership, membershipId: uuidv7(), workosUserId: otherId });
		const foodId = uuidv7();
		await source.foodUserEntries.put({
			...metadata,
			id: foodId,
			workosUserId: otherId,
			canonicalLabel: 'Bobs food',
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null,
			adoptionStatus: 'accepted'
		});
		const ingredients = recipe.ingredients.map((row) => ({ ...row, baseFoodId: foodId }));
		await source.recipes.update(recipe.id, { ingredients });
		await source.meals.update(meal.id, {
			ingredients: ingredients.map((row) => ({ ...row, baseFoodId: 'missing-for-everyone' }))
		});
		await source.unitHouseholdEntries.put({
			...metadata,
			id: uuidv7(),
			householdId,
			canonicalLabel: 'Dangling shared unit',
			baseUnitId: 'missing-for-everyone',
			toBaseFactor: 1,
			toBaseOffset: 0,
			adoptionStatus: 'accepted'
		});
		const recovery = await exportRecoveryArchives(source);
		expect(recovery.skipped).toEqual({ unitHouseholdEntries: 1 });
		expect(recovery.repaired).toEqual({ recipes: 1, meals: 1 });
		for (const exported of recovery.archives) {
			const archive = await decodePortableArchive(exported.blob);
			if (exported.workosUserId === userId) {
				expect(archive.recipes.recipes[0]?.ingredients[0]?.baseFoodId).toBeNull();
				expect(archive.taxonomy.foodUserEntries).toEqual([]);
			} else expect(archive.taxonomy.foodUserEntries[0]?.id).toBe(foodId);
			await restoreFresh(archive, exported.workosUserId);
		}
	});
});
