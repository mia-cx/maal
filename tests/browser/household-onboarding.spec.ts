import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import HouseholdOnboarding from '$lib/components/household/household-onboarding.svelte';
import '../../src/routes/layout.css';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const databases: MaalDatabase[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

const signedInDatabase = async (): Promise<{ database: MaalDatabase; profileId: string }> => {
	const database = await openMaalDatabase(`onboarding-browser-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	await database.profiles.add({
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
	await database.authSlots.add({
		authSlotId: 'a'.repeat(32),
		profileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	return { database, profileId };
};

test('retries a failed household creation with the same idempotency key', async () => {
	const { database, profileId } = await signedInDatabase();
	const keys: Array<string | null> = [];
	vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
		keys.push(new Headers(init?.headers).get('idempotency-key'));
		throw new TypeError('network down');
	});
	const screen = await render(HouseholdOnboarding, { database, profileId });

	await screen.getByLabelText('Household name').fill('Canal kitchen');
	await screen.getByRole('button', { name: 'Create household' }).click();
	await expect.element(screen.getByRole('alert')).toBeVisible();
	await screen.getByRole('button', { name: 'Create household' }).click();
	await expect.poll(() => keys.length).toBe(2);
	expect(keys[0]).toBeTruthy();
	expect(keys[1]).toBe(keys[0]);

	await screen.getByLabelText('Household name').fill('Friday table');
	await screen.getByRole('button', { name: 'Create household' }).click();
	await expect.poll(() => keys.length).toBe(3);
	expect(keys[2]).not.toBe(keys[0]);
});
