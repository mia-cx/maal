import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import HouseholdTaxonomyPreferences from '$lib/components/household/household-taxonomy-preferences.svelte';
import '../../src/routes/layout.css';

const databases: MaalDatabase[] = [];

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

test('saves the approved household unit controls directly to Dexie', async () => {
	const database = await openMaalDatabase(`taxonomy-browser-${crypto.randomUUID()}`);
	databases.push(database);
	const screen = await render(HouseholdTaxonomyPreferences, {
		database,
		authSlotId: 'slot-alice',
		originDeviceId: uuidv7(),
		workosUserId: 'user_alice',
		householdId: 'household_one',
		locale: 'en-US',
		canManageHousehold: true
	});

	await expect.element(screen.getByRole('heading', { name: 'Aliases & overrides' })).toBeVisible();
	await screen.getByTestId('weight-unit').getByRole('button').click();
	await page.getByText('lb', { exact: true }).click();
	await screen.getByRole('button', { name: 'Save overrides' }).click();

	await expect.poll(async () => database.householdUnitDisplayPreferences.count()).toBe(3);
	await expect.poll(async () => database.outbox.count()).toBe(3);
	await expect(
		database.householdUnitDisplayPreferences
			.where('[householdId+baseUnitId+locale]')
			.equals(['household_one', 'grams', 'en-US'])
			.first()
	).resolves.toMatchObject({ preferredUnitId: 'pounds', deletedAt: null });
	await expect.element(page.getByText('lb', { exact: true })).toBeVisible();
});
