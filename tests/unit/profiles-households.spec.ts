import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	addOrUpdateLocalProfile,
	detachHouseholdSnapshot,
	forkDetachedHouseholdSnapshot,
	listHouseholdsForProfile,
	openMaalDatabase,
	removeProfileFromDevice,
	setActiveHousehold,
	setProfilePin,
	switchActiveProfile,
	updateHouseholdAppliances,
	updateHouseholdSettings,
	type MaalDatabase
} from '$lib/client/local/index.js';
import {
	createHouseholdInvite,
	updateHouseholdMemberRole
} from '$lib/client/household-administration.js';
import { signOutLocalProfile } from '$lib/client/profile-sessions.js';
import {
	HouseholdSchema,
	MembershipSchema,
	ProfileSchema,
	hashInviteCode,
	type Household,
	type Membership,
	type Profile
} from '$lib/domain/household/index.js';

const databases: MaalDatabase[] = [];
const timestamp = '2026-08-21T12:00:00.000Z' as const;

const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`profiles-${crypto.randomUUID()}`);
	databases.push(database);
	return database;
};

afterEach(async () => {
	for (const database of databases) {
		const name = database.name;
		database.close();
		await Dexie.delete(name);
	}
	databases.length = 0;
});

const profile = (overrides: Partial<Profile> = {}): Profile =>
	Schema.decodeUnknownSync(ProfileSchema)({
		profileId: uuidv7(),
		workosUserId: `user_${crypto.randomUUID()}`,
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: timestamp,
		authState: 'authenticated',
		...overrides
	});

const household = (overrides: Partial<Household> = {}): Household =>
	Schema.decodeUnknownSync(HouseholdSchema)({
		schemaVersion: 1,
		revision: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		deletedAt: null,
		conflictClocks: {},
		householdId: 'org_household',
		name: 'Canal kitchen',
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		weekStartsOn: 1,
		defaultPlannedYield: 4,
		preferredDinnerTime: '18:30',
		createdByUserId: 'user_alice',
		deletionState: 'active',
		localOnly: false,
		...overrides
	});

const membership = (overrides: Partial<Membership> = {}): Membership =>
	Schema.decodeUnknownSync(MembershipSchema)({
		membershipId: `membership_${crypto.randomUUID()}`,
		householdId: 'org_household',
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
		source: 'workos',
		...overrides
	});

const addAuthSlot = async (database: MaalDatabase, value: Profile, suffix = 'a') => {
	await database.authSlots.add({
		authSlotId: suffix.repeat(32),
		profileId: value.profileId,
		workosUserId: value.workosUserId,
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
};

describe('device-local profile lifecycle', () => {
	test('switches profiles and unlocks a PIN without touching either retained auth slot', async () => {
		const database = await openDatabase();
		const alice = profile({ workosUserId: 'user_alice' });
		const bob = profile({
			workosUserId: 'user_bob',
			displayName: 'Bob',
			email: 'bob@example.test'
		});
		await database.profiles.bulkAdd([alice, bob]);
		await addAuthSlot(database, alice, 'a');
		await addAuthSlot(database, bob, 'b');
		await switchActiveProfile(database, alice.profileId);
		await setProfilePin(database, alice.profileId, '4826');
		await switchActiveProfile(database, bob.profileId);

		await expect(switchActiveProfile(database, alice.profileId)).rejects.toMatchObject({
			_tag: 'ProfilePinRequired'
		});
		await expect(switchActiveProfile(database, alice.profileId, '1111')).rejects.toMatchObject({
			_tag: 'ProfilePinInvalid'
		});
		await expect(switchActiveProfile(database, alice.profileId, '4826')).resolves.toMatchObject({
			profileId: alice.profileId
		});
		await expect(database.authSlots.count()).resolves.toBe(2);
		await expect(database.authSlots.toArray()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ authSlotId: 'a'.repeat(32), sessionState: 'authenticated' }),
				expect.objectContaining({ authSlotId: 'b'.repeat(32), sessionState: 'authenticated' })
			])
		);
	});

	test('caps retained authenticated profiles at eight while keeping signed-out profiles usable', async () => {
		const database = await openDatabase();
		for (let index = 0; index < 8; index += 1) {
			await addOrUpdateLocalProfile(
				database,
				profile({ workosUserId: `user_${index}`, displayName: `Cook ${index}` })
			);
		}
		await expect(
			addOrUpdateLocalProfile(database, profile({ workosUserId: 'user_nine' }))
		).rejects.toMatchObject({ _tag: 'LocalProfileCapacityExceeded', maximum: 8 });

		const first = await database.profiles.orderBy('lastUsedAt').first();
		expect(first).toBeDefined();
		await database.profiles.update(first!.profileId, { authState: 'signedOut' });
		await expect(
			addOrUpdateLocalProfile(database, profile({ workosUserId: 'user_nine' }))
		).resolves.toBeUndefined();
		await expect(database.profiles.count()).resolves.toBe(9);
	});

	test('keeps offline data on sign-out but removes private state only on device removal', async () => {
		const database = await openDatabase();
		const alice = profile({ workosUserId: 'user_alice' });
		const bob = profile({ workosUserId: 'user_bob' });
		const home = household({ createdByUserId: alice.workosUserId });
		await database.profiles.bulkAdd([alice, bob]);
		await addAuthSlot(database, alice, 'a');
		await addAuthSlot(database, bob, 'b');
		await database.households.add(home);
		await database.memberships.bulkAdd([
			membership({ workosUserId: alice.workosUserId }),
			membership({ workosUserId: bob.workosUserId, roleSlug: 'member' })
		]);
		const recipeId = uuidv7();
		await database.recipes.add({
			id: recipeId,
			ownerUserId: alice.workosUserId,
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {}
		});

		const revoke = vi.fn(async () => new Response(null, { status: 204 }));
		await signOutLocalProfile(database, alice.profileId, revoke as typeof fetch);
		expect(revoke).toHaveBeenCalledWith(`/api/auth-slots/${'a'.repeat(32)}/`, {
			method: 'DELETE'
		});
		await expect(database.recipes.get(recipeId)).resolves.toBeDefined();
		await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
			authState: 'signedOut'
		});

		const removed = await removeProfileFromDevice(database, alice.profileId);
		expect(removed.retainedHouseholdIds).toEqual([home.householdId]);
		await expect(database.recipes.get(recipeId)).resolves.toBeUndefined();
		await expect(database.households.get(home.householdId)).resolves.toBeDefined();
		await expect(
			database.authSlots.where('profileId').equals(alice.profileId).count()
		).resolves.toBe(0);
		await expect(database.authSlots.where('profileId').equals(bob.profileId).count()).resolves.toBe(
			1
		);
	});
});

describe('offline households and cached authority', () => {
	test('shares one household between profiles and changes settings/appliances with local outbox writes only', async () => {
		const database = await openDatabase();
		const alice = profile({ workosUserId: 'user_alice' });
		const bob = profile({ workosUserId: 'user_bob' });
		const home = household();
		await database.profiles.bulkAdd([alice, bob]);
		await addAuthSlot(database, alice, 'a');
		await addAuthSlot(database, bob, 'b');
		await database.households.add(home);
		await database.memberships.bulkAdd([
			membership({ workosUserId: alice.workosUserId }),
			membership({
				workosUserId: bob.workosUserId,
				roleSlug: 'member',
				permissions: ['recipes:read', 'recipes:write', 'meals:read', 'meals:write']
			})
		]);

		await expect(listHouseholdsForProfile(database, alice.profileId)).resolves.toMatchObject([
			{ household: { householdId: home.householdId }, detached: false }
		]);
		await expect(listHouseholdsForProfile(database, bob.profileId)).resolves.toMatchObject([
			{ household: { householdId: home.householdId }, detached: false }
		]);
		await setActiveHousehold(database, alice.profileId, home.householdId);
		await updateHouseholdSettings(database, {
			profileId: alice.profileId,
			householdId: home.householdId,
			patch: { name: 'Friday table', defaultPlannedYield: 6 },
			occurredAt: timestamp
		});
		const applianceId = uuidv7();
		await updateHouseholdAppliances(database, {
			profileId: alice.profileId,
			householdId: home.householdId,
			occurredAt: timestamp,
			appliances: [{ id: applianceId, appliance: 'oven', available: true, notes: null }]
		});

		await expect(database.households.get(home.householdId)).resolves.toMatchObject({
			name: 'Friday table',
			defaultPlannedYield: 6
		});
		await expect(database.householdAppliances.get(applianceId)).resolves.toMatchObject({
			appliance: 'oven',
			available: true
		});
		await expect(database.outbox.count()).resolves.toBe(2);
		await expect(
			updateHouseholdSettings(database, {
				profileId: bob.profileId,
				householdId: home.householdId,
				patch: { name: 'Not allowed' }
			})
		).rejects.toMatchObject({ _tag: 'CachedPermissionDenied', reason: 'permissionMissing' });
	});

	test('contacts the remote boundary only for explicit administration and stores no raw invite code', async () => {
		const database = await openDatabase();
		const alice = profile({ workosUserId: 'user_alice' });
		const home = household();
		await database.profiles.add(alice);
		await addAuthSlot(database, alice, 'a');
		await database.households.add(home);
		const aliceMembership = membership({ workosUserId: alice.workosUserId });
		await database.memberships.add(aliceMembership);
		const inviteId = uuidv7();
		const requestBodies: unknown[] = [];
		const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.body) requestBodies.push(JSON.parse(String(init.body)));
			return Response.json({
				schemaVersion: 1,
				payload: {
					id: inviteId,
					householdId: home.householdId,
					createdByUserId: alice.workosUserId,
					roleSlug: 'member',
					maxUses: 4,
					usesCount: 0,
					expiresAt: '2026-08-28T12:00:00.000Z',
					revokedAt: null,
					createdAt: timestamp
				}
			});
		});

		expect(fetcher).not.toHaveBeenCalled();
		const created = await createHouseholdInvite(
			database,
			alice.profileId,
			{ householdId: home.householdId, roleSlug: 'member', expiresInDays: 7, maxUses: 4 },
			fetcher as typeof fetch
		);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(requestBodies[0]).toMatchObject({ code: created.code, expiresInDays: 7 });
		const stored = await database.householdInvites.get(inviteId);
		expect(stored).toEqual(created.invite);
		expect(stored).not.toHaveProperty('code');
		expect(stored).not.toHaveProperty('codeHash');
		expect(await hashInviteCode(created.code)).toMatch(/^[0-9a-f]{64}$/);
	});

	test('commits decoded membership projections before returning from explicit role changes', async () => {
		const database = await openDatabase();
		const alice = profile({ workosUserId: 'user_alice' });
		const home = household();
		const target = membership({ workosUserId: 'user_bob', roleSlug: 'member' });
		await database.profiles.add(alice);
		await addAuthSlot(database, alice, 'a');
		await database.households.add(home);
		await database.memberships.bulkAdd([membership({ workosUserId: alice.workosUserId }), target]);
		const updated = {
			...target,
			roleSlug: 'child' as const,
			updatedAt: '2026-08-21T13:00:00.000Z'
		};
		const fetcher = vi.fn(async () => Response.json({ schemaVersion: 1, payload: updated }));

		await expect(
			updateHouseholdMemberRole(
				database,
				alice.profileId,
				{ householdId: home.householdId, membershipId: target.membershipId, roleSlug: 'child' },
				fetcher as typeof fetch
			)
		).resolves.toMatchObject({ roleSlug: 'child' });
		await expect(database.memberships.get(target.membershipId)).resolves.toMatchObject({
			roleSlug: 'child'
		});
	});

	test('quarantines denied work and forks an exportable detached snapshot with new IDs', async () => {
		const database = await openDatabase();
		const alice = profile({ workosUserId: 'user_alice' });
		const home = household();
		const aliceMembership = membership({ workosUserId: alice.workosUserId });
		await database.profiles.add(alice);
		await addAuthSlot(database, alice, 'a');
		await database.households.add(home);
		await database.memberships.add(aliceMembership);
		const mealId = uuidv7();
		const checkInId = uuidv7();
		await database.meals.add({
			id: mealId,
			householdId: home.householdId,
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
		await database.mealCheckIns.add({
			id: checkInId,
			mealId,
			reporterUserId: alice.workosUserId,
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {}
		});
		await database.outbox.add({
			mutationId: uuidv7(),
			authSlotId: 'a'.repeat(32),
			scopeKind: 'household',
			scopeId: home.householdId,
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

		await detachHouseholdSnapshot(database, {
			profileId: alice.profileId,
			householdId: home.householdId,
			denialCode: 'membership_revoked',
			detachedAt: timestamp
		});
		await expect(database.memberships.get(aliceMembership.membershipId)).resolves.toMatchObject({
			status: 'detached',
			denialCode: 'membership_revoked'
		});
		await expect(database.outbox.toArray()).resolves.toMatchObject([{ status: 'quarantined' }]);
		await expect(listHouseholdsForProfile(database, alice.profileId)).resolves.toMatchObject([
			{ detached: true }
		]);

		const fork = await forkDetachedHouseholdSnapshot(database, {
			profileId: alice.profileId,
			householdId: home.householdId,
			name: 'Canal kitchen copy',
			occurredAt: timestamp
		});
		expect(fork).toMatchObject({ mealCount: 1, checkInCount: 1 });
		expect(fork.householdId).not.toBe(home.householdId);
		await expect(database.households.get(fork.householdId)).resolves.toMatchObject({
			name: 'Canal kitchen copy',
			localOnly: true
		});
		const copiedMeal = await database.meals.where('householdId').equals(fork.householdId).first();
		expect(copiedMeal?.id).not.toBe(mealId);
		const copiedCheckIn = await database.mealCheckIns
			.filter((candidate) => candidate.mealId === copiedMeal?.id)
			.first();
		expect(copiedCheckIn?.id).not.toBe(checkInId);
	});
});
