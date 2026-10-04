import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	createHouseholdInvite,
	leaveRemoteHousehold,
	refreshRemoteHousehold,
	removeHouseholdMember,
	revokeHouseholdInvite,
	updateHouseholdMemberRole
} from '$lib/client/household-administration.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/index.js';
import { listHouseholdsForProfile } from '$lib/client/local/households.js';
import { collectPortableArchive } from '$lib/client/portability/archive.js';
import type {
	HouseholdAdministrationProjection,
	HouseholdMemberIdentity
} from '$lib/domain/household/administration.js';
import type {
	Household,
	HouseholdInviteSummary,
	Membership,
	Profile
} from '$lib/domain/household/contracts.js';

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

const seed = async () => {
	const db = await openMaalDatabase(`household-admin-${crypto.randomUUID()}`);
	database = db;
	const alice = profile('user_alice', 'Alice Janssen');
	const family = household('org_family', 'Canal kitchen');
	const aliceMembership = membership(
		'membership_alice',
		family.householdId,
		alice.workosUserId,
		'admin'
	);
	const bobMembership = membership('membership_bob', family.householdId, 'user_bob');
	await db.profiles.put(alice);
	await db.authSlots.put({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		profileId: alice.profileId,
		workosUserId: alice.workosUserId,
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	await db.households.put(family);
	await db.memberships.bulkPut([aliceMembership, bobMembership]);
	const projection: HouseholdAdministrationProjection = {
		household: family,
		membership: aliceMembership,
		members: [
			{ membership: aliceMembership, user: identity('user_alice', 'Alice Janssen') },
			{ membership: bobMembership, user: identity('user_bob', 'Bob Janssen') }
		],
		invites: []
	};
	return { db, alice, family, aliceMembership, bobMembership, projection };
};

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
		await database.authSlots.put({
			authSlotId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			profileId: bob.profileId,
			workosUserId: bob.workosUserId,
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
			conflictClocks: {},
			sourceRecipeId: null,
			title: 'Family soup',
			description: null,
			imageUrl: null,
			time: null,
			plannedCookUserId: null,
			yield: 4,
			plannedYield: 4,
			prepTimeMinutes: null,
			cookTimeMinutes: null,
			totalTimeMinutes: null,
			sourceYieldText: null,
			sourceDatePublished: null,
			sourceDateModified: null,
			sourceLanguage: null,
			sourceUrl: null,
			sourceSiteName: null,
			sourceAuthorName: null,
			sourcePublisherName: null,
			sourceIsBasedOnUrl: null,
			sourceImportedAt: timestamp,
			sourceHtmlHash: null,
			sourceRatingValue: null,
			sourceRatingCount: null,
			sourceReviewCount: null,
			sourceClaimedMinutes: null,
			parseConfidence: null,
			ingredientConfidence: null,
			instructionConfidence: null,
			nutritionConfidence: null,
			notes: null,
			ingredients: [],
			instructions: [],
			instructionEvents: [],
			applianceRequirements: [],
			classifications: [],
			media: [],
			nutritionFacts: []
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
		await database.outbox.put({
			...(await database.outbox.toArray())[0]!,
			mutationId: uuidv7(),
			authSlotId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
		});
		const scope = {
			scopeKind: 'household' as const,
			scopeId: family.householdId,
			cursor: null,
			bootstrapGeneration: null,
			retainedFloor: null,
			state: 'syncing' as const,
			leaseOwner: 'alice-sync',
			leaseExpiresAt: timestamp,
			lastSuccessAt: null,
			lastErrorCode: null
		};
		await database.syncScopes.put(scope);

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
			status: 'detached',
			denialCode: 'workos_membership_missing'
		});
		await expect(listHouseholdsForProfile(database, bob.profileId)).resolves.toContainEqual({
			household: projection.household,
			membership: {
				...staleBobMembership,
				status: 'detached',
				detachedAt: timestamp,
				denialCode: 'workos_membership_missing'
			},
			detached: true
		});
		const archive = await collectPortableArchive(database, bob.profileId);
		expect(archive.households.households).toContainEqual(
			expect.objectContaining({ householdId: family.householdId })
		);
		await expect(database.outbox.toArray()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					authSlotId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
					status: 'quarantined'
				}),
				expect.objectContaining({
					authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					status: 'pending'
				})
			])
		);
		await expect(database.userAttributions.get('user_charlie')).resolves.toMatchObject({
			displayName: 'Charlie Janssen',
			email: 'charlie@example.test'
		});
		await expect(database.meals.get(mealId)).resolves.toBeDefined();
		await expect(database.syncScopes.get(['household', family.householdId])).resolves.toEqual(
			scope
		);

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
		await expect(database.outbox.toArray()).resolves.toMatchObject([
			{ status: 'quarantined' },
			{ status: 'quarantined' }
		]);
		await expect(database.meals.get(mealId)).resolves.toBeDefined();
		await expect(database.syncScopes.get(['household', family.householdId])).resolves.toMatchObject(
			{ state: 'blocked', leaseOwner: null }
		);
	});

	test('removing a device-resident member keeps their snapshot detached', async () => {
		const { db, alice, family, bobMembership } = await seed();
		const bob = profile('user_bob', 'Bob Janssen');
		await db.profiles.put(bob);
		await removeHouseholdMember(
			db,
			alice.profileId,
			family.householdId,
			bobMembership.membershipId,
			async () =>
				Response.json({
					schemaVersion: 1,
					payload: {
						householdId: family.householdId,
						membershipId: bobMembership.membershipId,
						removed: true
					}
				})
		);
		await expect(listHouseholdsForProfile(db, bob.profileId)).resolves.toMatchObject([
			{ detached: true }
		]);
		await expect(db.memberships.get(bobMembership.membershipId)).resolves.toMatchObject({
			status: 'detached',
			denialCode: 'workos_membership_missing'
		});
	});

	test.each(['leave', 'create invite', 'revoke invite', 'change role', 'remove member'] as const)(
		'discards an older refresh after a completed %s',
		async (action) => {
			const { db, alice, family, aliceMembership, bobMembership, projection } = await seed();
			const invite: HouseholdInviteSummary = {
				id: uuidv7(),
				householdId: family.householdId,
				roleSlug: 'member',
				maxUses: null,
				usesCount: 0,
				expiresAt: '2026-08-29T08:00:00.000Z',
				revokedAt: null,
				createdAt: timestamp,
				createdByUserId: alice.workosUserId
			};
			if (action === 'revoke invite') await db.householdInvites.put(invite);
			const response = Promise.withResolvers<Response>();
			const started = Promise.withResolvers<void>();
			const refresh = refreshRemoteHousehold(db, alice.profileId, family.householdId, async () => {
				started.resolve();
				return response.promise;
			});
			await started.promise;
			const fetcher = async (): Promise<Response> =>
				Response.json({
					schemaVersion: 1,
					payload:
						action === 'leave' || action === 'remove member'
							? {
									householdId: family.householdId,
									membershipId:
										action === 'leave' ? aliceMembership.membershipId : bobMembership.membershipId,
									removed: true
								}
							: action === 'change role'
								? { ...bobMembership, roleSlug: 'child' }
								: { ...invite, revokedAt: action === 'revoke invite' ? timestamp : null }
				});
			switch (action) {
				case 'leave':
					await leaveRemoteHousehold(db, alice.profileId, family.householdId, fetcher);
					break;
				case 'create invite':
					await createHouseholdInvite(
						db,
						alice.profileId,
						{
							householdId: family.householdId,
							roleSlug: 'member',
							expiresInDays: 7,
							maxUses: null
						},
						fetcher
					);
					break;
				case 'revoke invite':
					await revokeHouseholdInvite(db, alice.profileId, family.householdId, invite.id, fetcher);
					break;
				case 'change role':
					await updateHouseholdMemberRole(
						db,
						alice.profileId,
						{
							householdId: family.householdId,
							membershipId: bobMembership.membershipId,
							roleSlug: 'child'
						},
						fetcher
					);
					break;
				case 'remove member':
					await removeHouseholdMember(
						db,
						alice.profileId,
						family.householdId,
						bobMembership.membershipId,
						fetcher
					);
					break;
			}
			const committed = [await db.memberships.toArray(), await db.householdInvites.toArray()];
			response.resolve(
				Response.json({
					schemaVersion: 1,
					payload: { ...projection, household: { ...family, name: 'Stale name' } }
				})
			);
			await refresh;
			expect([await db.memberships.toArray(), await db.householdInvites.toArray()]).toEqual(
				committed
			);
			await expect(db.households.get(family.householdId)).resolves.toEqual(family);
		}
	);

	test.each(['revoked', 'detached'] as const)(
		'replaces a %s membership ID when a member rejoins',
		async (status) => {
			const { db, alice, family, bobMembership, projection } = await seed();
			await db.memberships.update(bobMembership.membershipId, { status });
			const replacement = { ...bobMembership, membershipId: 'membership_bob_rejoined' };
			await refreshRemoteHousehold(db, alice.profileId, family.householdId, async () =>
				Response.json({
					schemaVersion: 1,
					payload: {
						...projection,
						members: [
							projection.members[0],
							{ membership: replacement, user: identity('user_bob', 'Bob Janssen') }
						]
					}
				})
			);
			await expect(db.memberships.get(bobMembership.membershipId)).resolves.toBeUndefined();
			await expect(db.memberships.get(replacement.membershipId)).resolves.toEqual(replacement);
		}
	);

	test('detaches the snapshot when the server reports the membership inactive', async () => {
		database = await openMaalDatabase(`household-admin-${crypto.randomUUID()}`);
		const alice = profile('user_alice', 'Alice Janssen');
		const family = household('org_family', 'Canal kitchen');
		const aliceMembership = membership('membership_alice', family.householdId, alice.workosUserId);
		await database.profiles.put(alice);
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
		await database.households.put(family);
		await database.memberships.put(aliceMembership);

		const deniedFetcher: typeof fetch = vi.fn(async () =>
			Response.json(
				{
					schemaVersion: 1,
					error: { _tag: 'HouseholdAdministrationError', code: 'membership_inactive' }
				},
				{ status: 403 }
			)
		);
		await expect(
			refreshRemoteHousehold(database, alice.profileId, family.householdId, deniedFetcher)
		).rejects.toMatchObject({ _tag: 'HouseholdAdministrationUnavailable', status: 403 });

		await expect(database.memberships.get(aliceMembership.membershipId)).resolves.toMatchObject({
			status: 'detached',
			denialCode: 'membership_inactive'
		});
		await expect(database.households.get(family.householdId)).resolves.toEqual(family);
	});

	test('marks the profile reauth required when the server rejects the slot session', async () => {
		database = await openMaalDatabase(`household-admin-${crypto.randomUUID()}`);
		const alice = profile('user_alice', 'Alice Janssen');
		const family = household('org_family', 'Canal kitchen');
		await database.profiles.put(alice);
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
		await database.households.put(family);

		const expiredFetcher: typeof fetch = vi.fn(async () =>
			Response.json(
				{
					schemaVersion: 1,
					error: { _tag: 'HouseholdAdministrationError', code: 'auth_slot_expired' }
				},
				{ status: 401 }
			)
		);
		await expect(
			refreshRemoteHousehold(database, alice.profileId, family.householdId, expiredFetcher)
		).rejects.toMatchObject({ status: 401 });
		await expect(database.authSlots.get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject(
			{ sessionState: 'reauthRequired' }
		);
		await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
			authState: 'reauthRequired'
		});
	});

	test('keeps the membership active when a refresh is denied for another reason', async () => {
		database = await openMaalDatabase(`household-admin-${crypto.randomUUID()}`);
		const alice = profile('user_alice', 'Alice Janssen');
		const family = household('org_family', 'Canal kitchen');
		const aliceMembership = membership('membership_alice', family.householdId, alice.workosUserId);
		await database.profiles.put(alice);
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
		await database.households.put(family);
		await database.memberships.put(aliceMembership);

		const deniedFetcher: typeof fetch = vi.fn(async () =>
			Response.json(
				{
					schemaVersion: 1,
					error: { _tag: 'HouseholdAdministrationError', code: 'membership_projection_missing' }
				},
				{ status: 403 }
			)
		);
		await expect(
			refreshRemoteHousehold(database, alice.profileId, family.householdId, deniedFetcher)
		).rejects.toMatchObject({ status: 403 });
		await expect(database.memberships.get(aliceMembership.membershipId)).resolves.toMatchObject({
			status: 'active'
		});
	});
});
