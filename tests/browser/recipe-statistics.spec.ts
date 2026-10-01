import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { clearBrowserDatabasePromises, getBrowserDatabase } from '$lib/client/local/browser.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import {
	deleteMeal,
	planRecipeAsMeal,
	saveMealCheckIn,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { createRecipeFromEditor } from '$lib/client/recipes/commands.js';
import MenuPage from '../../src/routes/(app)/menu/+page.svelte';

const timestamp = '2026-08-22T09:00:00.000Z' as const;
const profileId = uuidv7();
const deviceId = uuidv7();

afterEach(async () => {
	const database = await getBrowserDatabase();
	database.close();
	await Dexie.delete(database.name);
	clearBrowserDatabasePromises();
});

test('recipe counters follow local meal and check-in changes', async () => {
	const database = await getBrowserDatabase();
	await database.profiles.put({
		profileId,
		workosUserId: 'user_alice',
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: timestamp,
		authState: 'authenticated'
	});
	await database.households.put({
		householdId: 'org_family',
		name: 'Family',
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
		createdAt: timestamp,
		updatedAt: timestamp,
		deletedAt: null,
		conflictClocks: {}
	});
	await database.memberships.put({
		membershipId: 'membership-family',
		householdId: 'org_family',
		workosUserId: 'user_alice',
		roleSlug: 'admin',
		permissions: ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: timestamp,
		lastVerifiedAt: timestamp,
		updatedAt: timestamp,
		detachedAt: null,
		denialCode: null,
		source: 'workos'
	});
	await database.uiState.bulkPut([
		{ key: 'activeProfileId', value: profileId },
		{ key: activeHouseholdKey(profileId), value: 'org_family' }
	]);
	const recipe = await createRecipeFromEditor(
		database,
		{ authSlotId: 'slot-alice', ownerUserId: 'user_alice', originDeviceId: deviceId },
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
	const context: MealCommandContext = {
		authSlotId: 'slot-alice',
		householdId: 'org_family',
		reporterUserId: 'user_alice',
		originDeviceId: deviceId
	};

	render(MenuPage);
	await expect.element(page.getByRole('button', { name: 'Open Sunday soup' })).toBeVisible();
	await expect.element(page.getByText('0 planned')).toBeVisible();

	const meal = await planRecipeAsMeal(database, context, recipe.id, { date: '2026-08-22' });
	await expect.element(page.getByText('1 planned')).toBeVisible();
	await expect.element(page.getByText('0 cooked')).toBeVisible();

	await saveMealCheckIn(database, context, meal.id, { status: 'cooked', verdict: 'repeat' });
	await expect.element(page.getByText('1 cooked')).toBeVisible();
	await expect.element(page.getByText('1 reviews')).toBeVisible();

	await deleteMeal(database, context, meal.id);
	await expect.element(page.getByText('0 planned')).toBeVisible();
	await expect.element(page.getByText('0 cooked')).toBeVisible();
	await expect.element(page.getByText('0 reviews')).toBeVisible();
});
