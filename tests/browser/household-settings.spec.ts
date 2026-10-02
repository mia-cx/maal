import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import type { HouseholdAdministrationProjection } from '$lib/domain/household/administration.js';
import type { Household, Membership } from '$lib/domain/household/contracts.js';
import HouseholdSettings from '$lib/components/household/household-settings.svelte';
import '../../src/routes/layout.css';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const slotId = 'a'.repeat(32);
const householdId = 'org_canal_kitchen';
const refreshPath = `/api/auth-slots/${slotId}/households/${householdId}`;
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

const identity = (workosUserId: string, displayName: string) => ({
	workosUserId,
	displayName,
	email: `${workosUserId.slice(5)}@example.test`,
	profilePictureUrl: null
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

/** Answers the household refresh with `projection` and fails every other request. */
const mockRefresh = (projection: () => HouseholdAdministrationProjection) => {
	const refreshes: string[] = [];
	vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
		const path = new URL(String(input), window.location.origin).pathname;
		if (path !== refreshPath) throw new TypeError(`unexpected request ${path}`);
		refreshes.push(path);
		return Response.json({ schemaVersion: 1, payload: projection() });
	});
	return refreshes;
};

test('refreshes members and invites from the server on open and when focus returns', async () => {
	const { database, profileId } = await seed();
	const alice = membership('user_alice', 'admin');
	const bob = membership('user_bob', 'member');
	let members = [{ membership: alice, user: identity('user_alice', 'Alice de Vries') }];
	const refreshes = mockRefresh(() => ({
		household: household(),
		membership: alice,
		members,
		invites: []
	}));

	const screen = await render(HouseholdSettings, { database, profileId, householdId });
	await expect.poll(() => refreshes.length).toBe(1);

	members = [...members, { membership: bob, user: identity('user_bob', 'Bob de Vries') }];
	// A focus event during the in-flight open refresh is deduplicated, so keep returning focus.
	await expect
		.poll(() => {
			window.dispatchEvent(new FocusEvent('focus'));
			return screen.getByText('Bob de Vries').query() !== null;
		})
		.toBe(true);
	expect(refreshes.length).toBeGreaterThanOrEqual(2);
	await expect(database.memberships.get(bob.membershipId)).resolves.toMatchObject({
		status: 'active'
	});
});

test('lists only members whose membership is still active', async () => {
	const { database, profileId } = await seed({
		members: [
			membership('user_alice', 'admin'),
			membership('user_bob', 'member', { status: 'revoked' })
		]
	});
	await database.userAttributions.put(identity('user_bob', 'Bob de Vries'));
	vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('offline'));

	const screen = await render(HouseholdSettings, { database, profileId, householdId });
	await expect.element(screen.getByRole('heading', { name: 'Members' })).toBeVisible();
	await expect.element(screen.getByText('Alice de Vries')).toBeVisible();
	await expect.element(screen.getByText('Bob de Vries')).not.toBeInTheDocument();
});

test('copies a shareable invite URL', async () => {
	const { database, profileId } = await seed();
	vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
		const path = new URL(String(input), window.location.origin).pathname;
		if (path !== `${refreshPath}/invites`) throw new TypeError(`unexpected request ${path}`);
		return Response.json({
			schemaVersion: 1,
			payload: {
				id: uuidv7(),
				householdId,
				roleSlug: 'member',
				maxUses: null,
				usesCount: 0,
				expiresAt: '2026-08-28T12:00:00.000Z',
				revokedAt: null,
				createdAt: timestamp,
				createdByUserId: 'user_alice'
			}
		});
	});
	const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

	const screen = await render(HouseholdSettings, { database, profileId, householdId });
	await screen.getByRole('button', { name: 'Invite people to your household' }).click();
	await page.getByRole('button', { name: 'Create invite link' }).click();
	await page.getByRole('button', { name: 'Copy URL' }).click();

	await expect.poll(() => writeText.mock.calls.length).toBe(1);
	expect(writeText.mock.calls[0]![0]).toMatch(
		new RegExp(`^${window.location.origin}/invite/[23456789A-HJ-NP-Z]{12}$`)
	);
});

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
