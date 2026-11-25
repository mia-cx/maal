import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import SyncRejectionNotice from '$lib/components/sync-rejection-notice.svelte';
import '../../src/routes/layout.css';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const slotId = 'a'.repeat(32);
const databases: MaalDatabase[] = [];

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

/** Opens a database whose active profile has an auth slot, as the app shell sees it. */
const openActiveProfile = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`sync-rejection-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	await database.profiles.put({
		profileId,
		workosUserId: 'user_alice',
		displayName: 'Alice',
		email: null,
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: timestamp,
		authState: 'authenticated'
	});
	await database.authSlots.put({
		authSlotId: slotId,
		profileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.uiState.put({ key: 'activeProfileId', value: profileId });
	return database;
};

/** Stores a meal edit the server rejected because the meal was deleted. */
const rejectMealEdit = (database: MaalDatabase, title: string, occurredAt: `${string}Z`) =>
	database.outbox.put({
		mutationId: uuidv7(),
		authSlotId: slotId,
		scopeKind: 'household',
		scopeId: 'org_family',
		status: 'rejected',
		occurredAt,
		aggregateId: uuidv7(),
		entityKind: 'meal',
		conflictGroup: 'schedule',
		operation: 'upsert',
		originDeviceId: uuidv7(),
		payload: { title },
		nextAttemptAt: occurredAt,
		attempts: 0,
		rejectionCode: 'tombstoned_entity'
	});

const deletedMessage = (title: string) =>
	`Your change to “${title}” wasn’t saved because it was deleted.`;

test('a rejected write stays on screen until the person dismisses it', async () => {
	const database = await openActiveProfile();
	await rejectMealEdit(database, 'Family soup', timestamp);

	render(SyncRejectionNotice, { database });

	await expect.element(page.getByText('Change not saved')).toBeVisible();
	await expect.element(page.getByText(deletedMessage('Family soup'))).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss' }).click();
	await expect.element(page.getByText('Change not saved')).not.toBeInTheDocument();
});

test('dismissing shows the rejected writes that did not fit', async () => {
	const database = await openActiveProfile();
	const titles = ['Soup', 'Stew', 'Curry', 'Pasta'];
	for (const [minute, title] of titles.entries()) {
		await rejectMealEdit(database, title, `2026-08-21T12:0${minute}:00.000Z`);
	}

	render(SyncRejectionNotice, { database });

	await expect.element(page.getByText('4 changes not saved')).toBeVisible();
	await expect.element(page.getByText('1 more change wasn’t saved.')).toBeVisible();
	await expect.element(page.getByText(deletedMessage('Pasta'))).not.toBeInTheDocument();
	await page.getByRole('button', { name: 'Dismiss' }).click();
	await expect.element(page.getByText('Change not saved')).toBeVisible();
	await expect.element(page.getByText(deletedMessage('Pasta'))).toBeVisible();
	await expect.element(page.getByText(deletedMessage('Soup'))).not.toBeInTheDocument();
});
