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

test('a rejected write stays on screen until the person dismisses it', async () => {
	const database = await openMaalDatabase(`sync-rejection-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	const mealId = uuidv7();
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
	await database.outbox.put({
		mutationId: uuidv7(),
		authSlotId: slotId,
		scopeKind: 'household',
		scopeId: 'org_family',
		status: 'rejected',
		occurredAt: timestamp,
		aggregateId: mealId,
		entityKind: 'meal',
		conflictGroup: 'schedule',
		operation: 'upsert',
		originDeviceId: uuidv7(),
		payload: { title: 'Family soup' },
		nextAttemptAt: timestamp,
		attempts: 0,
		rejectionCode: 'tombstoned_entity'
	});

	render(SyncRejectionNotice, { database });

	await expect.element(page.getByText('Change not saved')).toBeVisible();
	await expect
		.element(page.getByText('Your change to “Family soup” wasn’t saved because it was deleted.'))
		.toBeVisible();
	await page.getByRole('button', { name: 'Dismiss' }).click();
	await expect.element(page.getByText('Change not saved')).not.toBeInTheDocument();
});
