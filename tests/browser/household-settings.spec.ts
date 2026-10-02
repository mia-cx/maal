import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import type { Household, Membership } from '$lib/domain/household/contracts.js';
import HouseholdSettings from '$lib/components/household/household-settings.svelte';
import '../../src/routes/layout.css';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const slotId = 'a'.repeat(32);
const householdId = 'org_canal_kitchen';
const databases: MaalDatabase[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

const household = (overrides: Partial<Household> = {}): Household => ({
	householdId,
	name: 'Canal kitchen',
	locale: 'en-NL',
	timezone: 'Europe/Amsterdam',
	weekStartsOn: 1,
	defaultPlannedYield: 4,
	preferredDinnerTime: '18:30',
	createdByUserId: 'user_alice',
	deletionState: 'active',
	localOnly: false,
	schemaVersion: 1,
	revision: 1,
	createdAt: timestamp,
	updatedAt: timestamp,
	deletedAt: null,
	conflictClocks: {},
	...overrides
});

const membership = (
	workosUserId: string,
	roleSlug: Membership['roleSlug'],
	overrides: Partial<Membership> = {}
): Membership => ({
	membershipId: `membership_${workosUserId}`,
	householdId,
	workosUserId,
	roleSlug,
	permissions:
		roleSlug === 'admin'
			? ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write']
			: ['recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
	status: 'active',
	directoryManaged: false,
	workosCreatedAt: timestamp,
	lastVerifiedAt: timestamp,
	updatedAt: timestamp,
	detachedAt: null,
	denialCode: null,
	source: 'workos',
	...overrides
});

const seed = async (
	options: { household?: Household; members?: Membership[] } = {}
): Promise<{ database: MaalDatabase; profileId: string }> => {
	const database = await openMaalDatabase(`household-settings-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	await database.meta.put({ key: 'deviceId', value: uuidv7(), updatedAt: timestamp });
	await database.profiles.add({
		profileId,
		workosUserId: 'user_alice',
		displayName: 'Alice de Vries',
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
		authSlotId: slotId,
		profileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	const seeded = options.household ?? household();
	await database.households.add(seeded);
	await database.memberships.bulkAdd(
		(options.members ?? [membership('user_alice', 'admin')]).map((candidate) => ({
			...candidate,
			householdId: seeded.householdId
		}))
	);
	return { database, profileId };
};

test('deletes a local-only household on this device without contacting the server', async () => {
	const localHousehold = household({ householdId: uuidv7(), localOnly: true });
	const { database, profileId } = await seed({
		household: localHousehold,
		members: [membership('user_alice', 'admin', { source: 'localFork' })]
	});
	const fetch = vi.spyOn(window, 'fetch');

	const screen = await render(HouseholdSettings, {
		database,
		profileId,
		householdId: localHousehold.householdId
	});
	await screen.getByRole('button', { name: 'Delete household' }).click();
	await page
		.getByRole('dialog', { name: 'Delete household?' })
		.getByRole('button', { name: 'Delete household' })
		.click();

	await expect.poll(() => database.households.get(localHousehold.householdId)).toBeUndefined();
	expect(fetch).not.toHaveBeenCalled();
});
