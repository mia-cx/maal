import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import {
	deleteMeal,
	planRecipeAsMeal,
	saveMealCheckIn,
	setMealStatus,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { createRecipeFromEditor } from '$lib/client/recipes/commands.js';
import { readRecipeStatistics } from '$lib/client/recipes/statistics.js';
import type { Household, Membership, Profile } from '$lib/domain/household/contracts.js';
import { RecipeImportedCandidateSchema } from '$lib/domain/recipes/schema.js';
import { emptyRecipeStats } from '$lib/menu/recipe-defaults.js';
import {
	importedCandidateToMenuItem,
	recipeAggregateToMenuItem
} from '$lib/menu/recipe-local-adapter.js';

const at = (day: number): `${string}Z` => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const deviceId = uuidv7();
const aliceProfileId = uuidv7();
const databases: MaalDatabase[] = [];

afterEach(async () => {
	for (const database of databases) {
		database.close();
		await Dexie.delete(database.name);
	}
	databases.length = 0;
});

const household = (householdId: string): Household => ({
	householdId,
	name: householdId,
	locale: 'en-NL',
	timezone: 'Europe/Amsterdam',
	weekStartsOn: 1,
	defaultPlannedYield: 2,
	preferredDinnerTime: null,
	createdByUserId: 'user_alice',
	deletionState: 'active',
	localOnly: false,
	schemaVersion: 1,
	revision: 1,
	createdAt: at(1),
	updatedAt: at(1),
	deletedAt: null,
	conflictClocks: {}
});

const membership = (householdId: string, status: Membership['status'] = 'active'): Membership => ({
	membershipId: `membership-${householdId}`,
	householdId,
	workosUserId: 'user_alice',
	roleSlug: 'admin',
	permissions: ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
	status,
	directoryManaged: false,
	workosCreatedAt: at(1),
	lastVerifiedAt: at(1),
	updatedAt: at(1),
	detachedAt: null,
	denialCode: null,
	source: 'workos'
});

const alice: Profile = {
	profileId: aliceProfileId,
	workosUserId: 'user_alice',
	displayName: 'Alice',
	email: 'alice@example.test',
	profilePictureUrl: null,
	locale: 'en-NL',
	timezone: 'Europe/Amsterdam',
	pinSalt: null,
	pinVerifier: null,
	lockPolicy: 'none',
	lastUsedAt: at(1),
	authState: 'authenticated'
};

const openKitchen = async () => {
	const database = await openMaalDatabase(`recipe-statistics-${crypto.randomUUID()}`);
	databases.push(database);
	await database.profiles.put(alice);
	await database.households.bulkPut([household('org_family'), household('org_other')]);
	await database.memberships.bulkPut([membership('org_family'), membership('org_other')]);
	await database.uiState.bulkPut([
		{ key: 'activeProfileId', value: aliceProfileId },
		{ key: activeHouseholdKey(aliceProfileId), value: 'org_family' }
	]);
	const recipe = await createRecipeFromEditor(
		database,
		{
			authSlotId: 'slot-alice',
			ownerUserId: 'user_alice',
			originDeviceId: deviceId,
			occurredAt: at(2)
		},
		{
			title: 'Sunday soup',
			description: null,
			imageUrl: null,
			sourceUrl: null,
			sourceSiteName: null,
			sourceAuthorName: null,
			sourcePublisherName: null,
			sourceIsBasedOnUrl: null,
			prepTimeMinutes: null,
			cookTimeMinutes: 25,
			yield: 2,
			ingredients: [{ id: null, amount: '1', unit: '', item: 'onion' }],
			instructions: [{ id: null, position: 1, text: 'Simmer.' }]
		}
	);
	return { database, recipe };
};

const cook = (
	householdId: string,
	day: number,
	reporterUserId = 'user_alice'
): MealCommandContext => ({
	authSlotId: 'slot-alice',
	householdId,
	reporterUserId,
	originDeviceId: deviceId,
	occurredAt: at(day)
});

describe('recipe statistics', () => {
	test('derive cook, plan, and review counts from the active household', async () => {
		const { database, recipe } = await openKitchen();
		const plan = (date: string | null) =>
			planRecipeAsMeal(database, cook('org_family', 3), recipe.id, { date });

		const first = await plan('2026-08-10');
		await saveMealCheckIn(database, cook('org_family', 10), first.id, {
			status: 'cooked',
			verdict: 'repeat',
			cookTimeMinutes: 30,
			reason: 'Great with bread'
		});
		const second = await plan('2026-08-12');
		await saveMealCheckIn(database, cook('org_family', 12, 'user_bob'), second.id, {
			status: 'cooked',
			verdict: 'neutral',
			cookTimeMinutes: 40
		});
		const skipped = await plan('2026-08-14');
		await saveMealCheckIn(database, cook('org_family', 14), skipped.id, {
			status: 'skipped',
			verdict: 'avoid',
			reason: 'Too salty'
		});
		await plan('2026-08-30');

		expect((await readRecipeStatistics(database)).get(recipe.id)).toEqual({
			plannedCount: 4,
			timesCooked: 2,
			lastCookedAt: '2026-08-12',
			averageActualMinutes: 35,
			latestVerdict: 'avoid',
			reviewSummary: {
				worthRepeating: 1,
				neutral: 1,
				neverAgain: 1,
				notes: ['Great with bread', 'Too salty']
			}
		});
	});

	test('fall back to the cooked update time when a cooked meal has no date', async () => {
		const { database, recipe } = await openKitchen();
		const meal = await planRecipeAsMeal(database, cook('org_family', 3), recipe.id);
		await setMealStatus(database, cook('org_family', 9), meal.id, 'cooked');

		expect((await readRecipeStatistics(database)).get(recipe.id)).toEqual({
			...emptyRecipeStats(),
			plannedCount: 1,
			timesCooked: 1,
			lastCookedAt: at(9)
		});
	});

	test('ignore deleted meals and deleted check-ins', async () => {
		const { database, recipe } = await openKitchen();
		const deleted = await planRecipeAsMeal(database, cook('org_family', 3), recipe.id);
		await saveMealCheckIn(database, cook('org_family', 4), deleted.id, {
			status: 'cooked',
			verdict: 'avoid'
		});
		await deleteMeal(database, cook('org_family', 5), deleted.id);
		const kept = await planRecipeAsMeal(database, cook('org_family', 6), recipe.id);
		const { checkIn } = await saveMealCheckIn(database, cook('org_family', 7), kept.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await database.mealCheckIns.update(checkIn.id, { deletedAt: at(8) });

		expect((await readRecipeStatistics(database)).get(recipe.id)).toEqual({
			...emptyRecipeStats(),
			plannedCount: 1,
			timesCooked: 1,
			lastCookedAt: at(7)
		});
	});

	test('follow the active profile, active household, and membership access', async () => {
		const { database, recipe } = await openKitchen();
		await planRecipeAsMeal(database, cook('org_family', 3), recipe.id);
		const other = await planRecipeAsMeal(database, cook('org_other', 3), recipe.id);
		await setMealStatus(database, cook('org_other', 4), other.id, 'cooked');
		await planRecipeAsMeal(database, cook('org_other', 5), recipe.id);

		const statsFor = async () => (await readRecipeStatistics(database)).get(recipe.id);
		expect(await statsFor()).toMatchObject({ plannedCount: 1, timesCooked: 0 });

		await database.uiState.put({ key: activeHouseholdKey(aliceProfileId), value: 'org_other' });
		expect(await statsFor()).toMatchObject({ plannedCount: 2, timesCooked: 1 });

		await database.memberships.put(membership('org_other', 'detached'));
		expect(await statsFor()).toMatchObject({ plannedCount: 2, timesCooked: 1 });

		await database.memberships.put(membership('org_other', 'revoked'));
		expect(await statsFor()).toBeUndefined();

		await database.uiState.delete('activeProfileId');
		await database.uiState.put({ key: activeHouseholdKey(aliceProfileId), value: 'org_family' });
		expect(await statsFor()).toBeUndefined();
	});
});

describe('recipe menu adapter statistics', () => {
	test('applies derived statistics to stored recipes and keeps candidates empty', async () => {
		const { recipe } = await openKitchen();
		const stats = {
			plannedCount: 3,
			timesCooked: 2,
			lastCookedAt: '2026-08-12',
			averageActualMinutes: 35,
			latestVerdict: 'repeat' as const,
			reviewSummary: { worthRepeating: 2, neutral: 0, neverAgain: 0, notes: ['Again'] }
		};
		expect(recipeAggregateToMenuItem(recipe, stats)).toMatchObject(stats);

		const candidate = Schema.decodeUnknownSync(RecipeImportedCandidateSchema)(recipe);
		const item = importedCandidateToMenuItem(candidate, 'draft-recipe-1');
		expect({
			timesCooked: item.timesCooked,
			plannedCount: item.plannedCount,
			lastCookedAt: item.lastCookedAt,
			averageActualMinutes: item.averageActualMinutes,
			latestVerdict: item.latestVerdict,
			reviewSummary: item.reviewSummary
		}).toEqual(emptyRecipeStats());
	});
});
