import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { clearBrowserDatabasePromises, getBrowserDatabase } from '$lib/client/local/browser.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import {
	collectPortableArchive,
	createPortableArchiveBlob
} from '$lib/client/portability/index.js';
import { createRecipeFromEditor } from '$lib/client/recipes/commands.js';
import PortableDataDialog from '../../src/lib/components/portable-data-dialog.svelte';

const timestamp = '2026-08-22T09:00:00.000Z' as const;
const profileId = uuidv7();
const deviceId = uuidv7();

afterEach(async () => {
	const database = await getBrowserDatabase();
	database.close();
	await Dexie.delete(database.name);
	clearBrowserDatabasePromises();
});

test('a chosen archive plans its collisions and replaces local records', async () => {
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

	// manifest.json records each file's byte count, so the retitle keeps its length.
	const collected = await collectPortableArchive(database, profileId);
	const archive = {
		...collected,
		recipes: {
			...collected.recipes,
			recipes: collected.recipes.recipes.map((row, index) =>
				index === 0 ? { ...row, title: 'Monday soup' } : row
			)
		}
	};
	const file = new File([await createPortableArchiveBlob(archive)], 'soup.zip', {
		type: 'application/zip'
	});

	render(PortableDataDialog, { database, profileId, open: true });
	const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
	expect(fileInput).toBeTruthy();
	await userEvent.upload(fileInput!, file);

	await expect.element(page.getByText('Monday soup')).toBeVisible();
	await userEvent.click(page.getByRole('button', { name: 'Replace all' }));
	const importButton = page.getByRole('button', { name: /Import \d+ records/ });
	await expect.element(importButton).toBeEnabled();
	await userEvent.click(importButton);
	await expect.element(page.getByText(/Imported \d+ records from soup\.zip/)).toBeVisible();
	expect((await database.recipes.get(recipe.id))?.title).toBe('Monday soup');
});
