import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	leaveRemoteHousehold,
	refreshRemoteHousehold
} from '$lib/client/household-administration.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/index.js';
import type {
	HouseholdAdministrationProjection,
	HouseholdMemberIdentity
} from '$lib/domain/household/administration.js';
import type { Household, Membership, Profile } from '$lib/domain/household/contracts.js';

const timestamp = '2026-08-22T08:00:00.000Z' as const;
let database: MaalDatabase | null = null;

const profile = (workosUserId: string, displayName: string): Profile => ({
	profileId: uuidv7(),
	workosUserId,
	displayName,
	email: `${workosUserId.slice(5)}@example.test`,
	profilePictureUrl: null,
	locale: 'en-NL',
	timezone: 'Europe/Amsterdam',
	pinSalt: null,
	pinVerifier: null,
	lockPolicy: 'none',
	lastUsedAt: timestamp,
	authState: 'authenticated'
});

const household = (householdId: string, name: string): Household => ({
	householdId,
	name,
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
	conflictClocks: {}
});

const membership = (
	membershipId: string,
	householdId: string,
	workosUserId: string,
	roleSlug: Membership['roleSlug'] = 'member'
): Membership => ({
	membershipId,
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
	source: 'workos'
});

const identity = (workosUserId: string, displayName: string): HouseholdMemberIdentity => ({
	workosUserId,
	displayName,
	email: `${workosUserId.slice(5)}@example.test`,
	profilePictureUrl: null
});

afterEach(async () => {
	if (!database) return;
	const name = database.name;
	database.close();
	await Dexie.delete(name);
	database = null;
});

describe('household administration Dexie projection', () => {
	test('refreshes one household and leaves it detached without replacing another profile or content', async () => {
		database = await openMaalDatabase(`household-admin-${crypto.randomUUID()}`);
		const alice = profile('user_alice', 'Alice Janssen');
		const bob = profile('user_bob', 'Bob Janssen');
		const family = household('org_family', 'Old family name');
		const other = household('org_other', 'Bob kitchen');
		const aliceMembership = membership(
			'membership_alice',
			family.householdId,
			alice.workosUserId,
			'admin'
		);
		const staleBobMembership = membership(
			'membership_bob_stale',
			family.householdId,
			bob.workosUserId
		);
		const otherMembership = membership(
			'membership_bob_other',
			other.householdId,
			bob.workosUserId,
			'admin'
		);
		await database.profiles.bulkPut([alice, bob]);
		await database.authSlots.put({
			authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			profileId: alice.profileId,
			workosUserId: alice.workosUserId,
			sessionState: 'authenticated',
			lastRefreshedAt: timestamp,
			lastVerifiedAt: timestamp,
			nextRetryAt: null,
			retryCount: 0
		});
		await database.households.bulkPut([family, other]);
		await database.memberships.bulkPut([aliceMembership, staleBobMembership, otherMembership]);
		const mealId = uuidv7();
		await database.meals.put({
			id: mealId,
			householdId: family.householdId,
			date: '2026-08-22',
			status: 'planned',
			sortOrder: 1000,
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {}
		});
		await database.outbox.put({
			mutationId: uuidv7(),
			authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			scopeKind: 'household',
			scopeId: family.householdId,
			status: 'pending',
			occurredAt: timestamp,
			aggregateId: mealId,
			entityKind: 'meal',
			conflictGroup: 'schedule',
			operation: 'upsert',
			originDeviceId: uuidv7(),
			payload: {},
			nextAttemptAt: timestamp,
			attempts: 0
		});

		const charlieMembership = membership('membership_charlie', family.householdId, 'user_charlie');
		const projection: HouseholdAdministrationProjection = {
			household: { ...family, name: 'Canal kitchen', revision: 2, updatedAt: timestamp },
			membership: aliceMembership,
			members: [
				{ membership: aliceMembership, user: identity(alice.workosUserId, alice.displayName) },
				{
					membership: charlieMembership,
					user: identity('user_charlie', 'Charlie Janssen')
				}
			],
			invites: []
		};
		const refreshFetcher: typeof fetch = vi.fn(async () =>
			Response.json({ schemaVersion: 1, payload: projection })
		);
		await refreshRemoteHousehold(database, alice.profileId, family.householdId, refreshFetcher);

		await expect(database.profiles.count()).resolves.toBe(2);
		await expect(database.households.get(other.householdId)).resolves.toEqual(other);
		await expect(database.memberships.get(otherMembership.membershipId)).resolves.toEqual(
			otherMembership
		);
		await expect(database.memberships.get(staleBobMembership.membershipId)).resolves.toMatchObject({
			status: 'revoked',
			denialCode: 'workos_membership_missing'
		});
		await expect(database.userAttributions.get('user_charlie')).resolves.toMatchObject({
			displayName: 'Charlie Janssen',
			email: 'charlie@example.test'
		});
		await expect(database.meals.get(mealId)).resolves.toBeDefined();

		const leaveFetcher: typeof fetch = vi.fn(async () =>
			Response.json({
				schemaVersion: 1,
				payload: {
					householdId: family.householdId,
					membershipId: aliceMembership.membershipId,
					removed: true
				}
			})
		);
		await leaveRemoteHousehold(database, alice.profileId, family.householdId, leaveFetcher);
		await expect(database.memberships.get(aliceMembership.membershipId)).resolves.toMatchObject({
			status: 'detached',
			denialCode: 'membership_left'
		});
		await expect(database.outbox.toArray()).resolves.toMatchObject([{ status: 'quarantined' }]);
		await expect(database.meals.get(mealId)).resolves.toBeDefined();
	});
});
