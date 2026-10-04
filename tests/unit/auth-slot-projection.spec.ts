import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	AuthSlotCapacityExceeded,
	MAX_AUTHENTICATED_SLOTS,
	type AuthSlotId
} from '$lib/auth-slots/index.js';
import {
	AuthSlotMetadataUnavailable,
	projectAuthCallback,
	retainedAuthSlots,
	takeAuthCallbackMarker
} from '$lib/client/auth-slot-projection.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	finalizeProfileSignOut,
	lockProfile,
	requestProfilePinReset,
	setProfilePin,
	switchActiveProfile
} from '$lib/client/local/profiles.js';
import type { AuthSlotRecord, OutboxRecord } from '$lib/client/local/records.js';
import { ProfileSchema, type Profile } from '$lib/domain/household/contracts.js';

const ALICE_SLOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as AuthSlotId;
const BOB_SLOT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as AuthSlotId;
const timestamp = '2026-08-22T09:00:00.000Z' as const;
const databases: MaalDatabase[] = [];

const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`auth-projection-${crypto.randomUUID()}`);
	databases.push(database);
	return database;
};

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

const profile = (workosUserId: string, displayName: string): Profile =>
	Schema.decodeUnknownSync(ProfileSchema)({
		profileId: uuidv7(),
		workosUserId,
		displayName,
		email: `${displayName.toLowerCase()}@example.test`,
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: timestamp,
		authState: 'authenticated'
	});

const addSlot = async (database: MaalDatabase, owner: Profile, authSlotId: AuthSlotId) => {
	await database.authSlots.add({
		authSlotId,
		profileId: owner.profileId,
		workosUserId: owner.workosUserId,
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
};

const localRecipe = () => ({
	id: uuidv7(),
	ownerUserId: 'user_alice',
	schemaVersion: 1,
	revision: 1,
	createdAt: timestamp,
	updatedAt: timestamp,
	deletedAt: null,
	conflictClocks: {}
});

const queuedMutation = (
	authSlotId: string,
	overrides: Partial<OutboxRecord> = {}
): OutboxRecord => ({
	mutationId: uuidv7(),
	authSlotId,
	scopeKind: 'household',
	scopeId: 'org_canal',
	status: 'pending',
	occurredAt: timestamp,
	aggregateId: uuidv7(),
	entityKind: 'meal',
	conflictGroup: 'meal',
	operation: 'upsert',
	originDeviceId: 'device',
	payload: {},
	nextAttemptAt: timestamp,
	attempts: 0,
	...overrides
});

const authenticatedResponse = (
	authSlotId: AuthSlotId,
	workosUserId: string,
	firstName: string,
	proof: { freshAuthentication?: true; pinResetNonce?: string } = { freshAuthentication: true }
) =>
	new Response(
		JSON.stringify({
			schemaVersion: 1,
			authSlotId,
			status: 'authenticated',
			workosUserId,
			email: `${firstName.toLowerCase()}@example.test`,
			firstName,
			lastName: 'de Vries',
			profilePictureUrl: null,
			verifiedAt: timestamp,
			...proof,
			households: [],
			sealedSession: 'must be discarded'
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);

describe('auth callback marker', () => {
	test('removes only callback parameters before work starts and cannot replay from the clean URL', () => {
		const replacements: string[] = [];
		const url = new URL(
			`https://maal.test/plan?view=week&authSlot=${ALICE_SLOT}&authStatus=authenticated#dinner`
		);

		expect(takeAuthCallbackMarker(url, (value) => replacements.push(value))).toEqual({
			authSlotId: ALICE_SLOT,
			authStatus: 'authenticated'
		});
		expect(replacements).toEqual(['/plan?view=week#dinner']);

		const clean = new URL(replacements[0]!, url.origin);
		expect(takeAuthCallbackMarker(clean, (value) => replacements.push(value))).toBeNull();
		expect(replacements).toHaveLength(1);
	});
});

describe('auth callback projection', () => {
	test('projects household membership and paid capability before fresh-device authentication returns', async () => {
		const database = await openDatabase();
		const home = {
			householdId: 'org_family',
			name: 'Family kitchen',
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
		} as const;
		const aliceMembership = {
			membershipId: 'membership_alice',
			householdId: home.householdId,
			workosUserId: 'user_alice',
			roleSlug: 'admin',
			permissions: [
				'households:write',
				'recipes:read',
				'recipes:write',
				'meals:read',
				'meals:write'
			],
			status: 'active',
			directoryManaged: false,
			workosCreatedAt: timestamp,
			lastVerifiedAt: timestamp,
			updatedAt: timestamp,
			detachedAt: null,
			denialCode: null,
			source: 'workos'
		} as const;
		const capability = {
			householdId: home.householdId,
			state: 'enabled',
			stripeStatus: 'active',
			subscriberUserId: 'user_alice',
			stripePriceId: 'price_monthly',
			currentPeriodEnd: '2026-09-22T09:00:00.000Z',
			interruptionStartedAt: null,
			graceUntil: null,
			validUntil: '2026-09-22T09:00:00.000Z',
			cancelAtPeriodEnd: false,
			stale: false,
			source: 'stripe-d1'
		} as const;
		const fetcher = vi.fn(async () => {
			const response = await authenticatedResponse(ALICE_SLOT, 'user_alice', 'Alice');
			const body = (await response.json()) as Record<string, unknown>;
			return Response.json({
				...body,
				households: [{ household: home, membership: aliceMembership, capability }]
			});
		});

		const outcome = await projectAuthCallback(
			database,
			{ authSlotId: ALICE_SLOT, authStatus: 'authenticated' },
			{ fetcher, now: timestamp }
		);

		expect(outcome.state).toBe('authenticated');
		await expect(database.households.get(home.householdId)).resolves.toEqual(home);
		await expect(database.memberships.get(aliceMembership.membershipId)).resolves.toEqual(
			aliceMembership
		);
		await expect(database.billingCapabilities.get(home.householdId)).resolves.toEqual(capability);
		await expect(database.uiState.get(`activeHouseholdId:${outcome.profileId}`)).resolves.toEqual({
			key: `activeHouseholdId:${outcome.profileId}`,
			value: home.householdId
		});
	});

	test('adds Bob, selects him, and keeps Alice plus all unrelated local data', async () => {
		const database = await openDatabase();
		const alice = profile('user_alice', 'Alice');
		await database.profiles.add(alice);
		await addSlot(database, alice, ALICE_SLOT);
		await database.uiState.put({ key: 'activeProfileId', value: alice.profileId });
		await database.households.add({
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			deletedAt: null,
			conflictClocks: {},
			householdId: 'org_canal',
			name: 'Canal kitchen',
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			weekStartsOn: 1,
			defaultPlannedYield: 4,
			preferredDinnerTime: null,
			createdByUserId: 'user_alice',
			deletionState: 'active',
			localOnly: false
		});
		await database.recipes.add(localRecipe());

		const fetcher = vi.fn(async () => authenticatedResponse(BOB_SLOT, 'user_bob', 'Bob'));
		const outcome = await projectAuthCallback(
			database,
			{ authSlotId: BOB_SLOT, authStatus: 'authenticated' },
			{ fetcher, locale: 'en-NL', timezone: 'Europe/Amsterdam', now: timestamp }
		);

		expect(fetcher).toHaveBeenCalledWith(`/api/auth-slots/${BOB_SLOT}/`, {
			method: 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { accept: 'application/json' }
		});
		expect(outcome).toMatchObject({ state: 'authenticated', authSlotId: BOB_SLOT });
		await expect(database.profiles.count()).resolves.toBe(2);
		await expect(database.authSlots.count()).resolves.toBe(2);
		await expect(database.authSlots.get(ALICE_SLOT)).resolves.toMatchObject({
			profileId: alice.profileId,
			workosUserId: 'user_alice',
			sessionState: 'authenticated'
		});
		const bob = await database.profiles.where('workosUserId').equals('user_bob').first();
		expect(bob).toMatchObject({ displayName: 'Bob de Vries', authState: 'authenticated' });
		await expect(database.uiState.get('activeProfileId')).resolves.toMatchObject({
			value: bob?.profileId
		});
		await expect(database.households.count()).resolves.toBe(1);
		await expect(database.recipes.count()).resolves.toBe(1);
		await expect(database.userAttributions.get('user_bob')).resolves.toMatchObject({
			displayName: 'Bob de Vries'
		});
		expect(
			JSON.stringify({
				profiles: await database.profiles.toArray(),
				authSlots: await database.authSlots.toArray(),
				attributions: await database.userAttributions.toArray()
			})
		).not.toContain('must be discarded');
	});

	test('reauthenticates Alice idempotently without replacing Bob or Alice local state', async () => {
		const database = await openDatabase();
		const alice = {
			...profile('user_alice', 'Alice'),
			pinSalt: 'salt',
			pinVerifier: 'verifier',
			lockPolicy: 'pin' as const,
			authState: 'reauthRequired' as const
		};
		const bob = profile('user_bob', 'Bob');
		await database.profiles.bulkAdd([alice, bob]);
		await addSlot(database, alice, ALICE_SLOT);
		await addSlot(database, bob, BOB_SLOT);
		await database.authSlots.update(ALICE_SLOT, { sessionState: 'reauthRequired' });
		await database.uiState.bulkPut([
			{ key: 'activeProfileId', value: bob.profileId },
			{ key: `profileLock:${alice.profileId}`, value: true }
		]);
		const fetcher = vi.fn(async () => authenticatedResponse(ALICE_SLOT, 'user_alice', 'Alice'));

		for (let attempt = 0; attempt < 2; attempt += 1) {
			await projectAuthCallback(
				database,
				{ authSlotId: ALICE_SLOT, authStatus: 'authenticated' },
				{ fetcher, now: timestamp }
			);
		}

		await expect(database.profiles.count()).resolves.toBe(2);
		await expect(database.authSlots.count()).resolves.toBe(2);
		await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
			authState: 'authenticated',
			pinSalt: 'salt',
			pinVerifier: 'verifier',
			lockPolicy: 'pin'
		});
		await expect(database.uiState.get(`profileLock:${alice.profileId}`)).resolves.toMatchObject({
			value: false
		});
		await expect(database.uiState.get('activeProfileId')).resolves.toMatchObject({
			value: alice.profileId
		});
		await expect(database.authSlots.get(BOB_SLOT)).resolves.toMatchObject({
			profileId: bob.profileId,
			sessionState: 'authenticated'
		});
	});

	test('rejects a ninth authenticated profile without changing the existing projection', async () => {
		const database = await openDatabase();
		for (let index = 0; index < MAX_AUTHENTICATED_SLOTS; index += 1) {
			const retained = profile(`user_${index}`, `Cook ${index}`);
			await database.profiles.add(retained);
			await addSlot(database, retained, index.toString(16).padStart(32, '0') as AuthSlotId);
		}
		await database.uiState.put({ key: 'activeProfileId', value: 'original-profile' });
		const fetcher = vi.fn(async () => authenticatedResponse(BOB_SLOT, 'user_nine', 'Nine'));

		await expect(
			projectAuthCallback(
				database,
				{ authSlotId: BOB_SLOT, authStatus: 'authenticated' },
				{ fetcher }
			)
		).rejects.toBeInstanceOf(AuthSlotCapacityExceeded);

		expect(fetcher).toHaveBeenLastCalledWith(`/api/auth-slots/${BOB_SLOT}/?preserveIdentity=true`, {
			method: 'DELETE'
		});
		await expect(database.profiles.count()).resolves.toBe(MAX_AUTHENTICATED_SLOTS);
		await expect(database.authSlots.count()).resolves.toBe(MAX_AUTHENTICATED_SLOTS);
		await expect(database.profiles.where('workosUserId').equals('user_nine').count()).resolves.toBe(
			0
		);
		await expect(database.userAttributions.get('user_nine')).resolves.toBeUndefined();
		await expect(database.uiState.get('activeProfileId')).resolves.toMatchObject({
			value: 'original-profile'
		});
	});

	test('leaves reauth-required and signed-out profiles out of the eight-slot count', async () => {
		const database = await openDatabase();
		const views: { profile: Profile; slot: AuthSlotRecord }[] = [];
		for (let index = 0; index < MAX_AUTHENTICATED_SLOTS; index += 1) {
			const retained = profile(`user_${index}`, `Cook ${index}`);
			const authSlotId = index.toString(16).padStart(32, '0') as AuthSlotId;
			await database.profiles.add(retained);
			await addSlot(database, retained, authSlotId);
			views.push({ profile: retained, slot: (await database.authSlots.get(authSlotId))! });
		}
		await database.profiles.update(views[0]!.profile.profileId, { authState: 'reauthRequired' });
		views[0] = { ...views[0]!, profile: { ...views[0]!.profile, authState: 'reauthRequired' } };

		expect(retainedAuthSlots(views)).toHaveLength(MAX_AUTHENTICATED_SLOTS - 1);
		await expect(
			projectAuthCallback(
				database,
				{ authSlotId: BOB_SLOT, authStatus: 'authenticated' },
				{ fetcher: async () => authenticatedResponse(BOB_SLOT, 'user_nine', 'Nine') }
			)
		).resolves.toMatchObject({ state: 'authenticated' });
	});

	test('keeps a capacity-rejected profile ready to retry reauthentication on the same slot', async () => {
		const database = await openDatabase();
		const alice = { ...profile('user_alice', 'Alice'), authState: 'reauthRequired' as const };
		await database.profiles.add(alice);
		await addSlot(database, alice, ALICE_SLOT);
		await database.authSlots.update(ALICE_SLOT, { sessionState: 'reauthRequired' });
		const others: Profile[] = [];
		for (let index = 0; index < MAX_AUTHENTICATED_SLOTS; index += 1) {
			const retained = profile(`user_${index}`, `Cook ${index}`);
			others.push(retained);
			await database.profiles.add(retained);
			await addSlot(database, retained, index.toString(16).padStart(32, '0') as AuthSlotId);
		}
		const fetcher = vi.fn(async () => authenticatedResponse(ALICE_SLOT, 'user_alice', 'Alice'));
		const marker = { authSlotId: ALICE_SLOT, authStatus: 'authenticated' as const };

		await expect(projectAuthCallback(database, marker, { fetcher })).rejects.toBeInstanceOf(
			AuthSlotCapacityExceeded
		);
		expect(fetcher).toHaveBeenLastCalledWith(
			`/api/auth-slots/${ALICE_SLOT}/?preserveIdentity=true`,
			{
				method: 'DELETE'
			}
		);
		await expect(database.authSlots.get(ALICE_SLOT)).resolves.toMatchObject({
			profileId: alice.profileId,
			sessionState: 'reauthRequired'
		});
		await finalizeProfileSignOut(database, others[0]!.profileId);
		await expect(projectAuthCallback(database, marker, { fetcher })).resolves.toMatchObject({
			state: 'authenticated',
			profileId: alice.profileId,
			authSlotId: ALICE_SLOT
		});
	});

	test('moves work queued while signed out onto the slot Alice signs back in with', async () => {
		const database = await openDatabase();
		const alice = profile('user_alice', 'Alice');
		const bob = profile('user_bob', 'Bob');
		await database.profiles.bulkAdd([alice, bob]);
		await addSlot(database, alice, ALICE_SLOT);
		await addSlot(database, bob, BOB_SLOT);
		await finalizeProfileSignOut(database, alice.profileId);
		const oldSlotRow = queuedMutation(ALICE_SLOT);
		const signedOutRow = queuedMutation(`signed-out:${alice.profileId}`, { status: 'quarantined' });
		const acknowledgedRow = queuedMutation(ALICE_SLOT, { status: 'acknowledged' });
		const bobRow = queuedMutation(BOB_SLOT);
		await database.outbox.bulkAdd([oldSlotRow, signedOutRow, acknowledgedRow, bobRow]);
		const newSlot = 'c'.repeat(32) as AuthSlotId;

		await projectAuthCallback(
			database,
			{ authSlotId: newSlot, authStatus: 'authenticated' },
			{ fetcher: async () => authenticatedResponse(newSlot, 'user_alice', 'Alice'), now: timestamp }
		);

		await expect(database.authSlots.get(ALICE_SLOT)).resolves.toBeUndefined();
		const slotFor = async (row: OutboxRecord) =>
			(await database.outbox.get(row.mutationId))?.authSlotId;
		await expect(slotFor(oldSlotRow)).resolves.toBe(newSlot);
		await expect(slotFor(signedOutRow)).resolves.toBe(newSlot);
		await expect(slotFor(acknowledgedRow)).resolves.toBe(ALICE_SLOT);
		await expect(slotFor(bobRow)).resolves.toBe(BOB_SLOT);
	});

	test.each(['retained slot', 'fresh slot'])(
		'clears a forgotten PIN after owner sign-in on a %s',
		async (scenario) => {
			const database = await openDatabase();
			const alice = profile('user_alice', 'Alice');
			const bob = profile('user_bob', 'Bob');
			await database.profiles.bulkAdd([alice, bob]);
			await addSlot(database, alice, ALICE_SLOT);
			await addSlot(database, bob, BOB_SLOT);
			await switchActiveProfile(database, alice.profileId);
			await setProfilePin(database, alice.profileId, '4826');
			await switchActiveProfile(database, bob.profileId);
			if (scenario === 'fresh slot') await finalizeProfileSignOut(database, alice.profileId);
			const pinResetNonce = await requestProfilePinReset(database, alice.profileId);
			const authSlotId = scenario === 'fresh slot' ? ('c'.repeat(32) as AuthSlotId) : ALICE_SLOT;

			await projectAuthCallback(
				database,
				{ authSlotId, authStatus: 'authenticated' },
				{
					fetcher: async () =>
						authenticatedResponse(authSlotId, 'user_alice', 'Alice', {
							freshAuthentication: true,
							pinResetNonce
						})
				}
			);

			await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
				lockPolicy: 'none',
				pinSalt: null,
				pinVerifier: null
			});
			await expect(database.uiState.get('activeProfileId')).resolves.toMatchObject({
				value: alice.profileId
			});
			await expect(database.uiState.get(`profileLock:${alice.profileId}`)).resolves.toMatchObject({
				value: false
			});
		}
	);

	test.each([
		'retained session',
		'unrelated sign-in',
		'wrong reset request',
		'nonce without proof'
	])('does not clear a forgotten PIN using %s', async (scenario) => {
		const database = await openDatabase();
		const alice = profile('user_alice', 'Alice');
		await database.profiles.add(alice);
		await addSlot(database, alice, ALICE_SLOT);
		await switchActiveProfile(database, alice.profileId);
		await setProfilePin(database, alice.profileId, '4826');
		await lockProfile(database, alice.profileId);
		const pinResetNonce = await requestProfilePinReset(database, alice.profileId);
		const proof =
			scenario === 'retained session'
				? {}
				: scenario === 'unrelated sign-in'
					? { freshAuthentication: true as const }
					: scenario === 'wrong reset request'
						? { freshAuthentication: true as const, pinResetNonce: 'd'.repeat(32) }
						: { pinResetNonce };

		await projectAuthCallback(
			database,
			{ authSlotId: ALICE_SLOT, authStatus: 'authenticated' },
			{ fetcher: async () => authenticatedResponse(ALICE_SLOT, 'user_alice', 'Alice', proof) }
		);

		await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
			lockPolicy: 'pin',
			pinVerifier: expect.any(String)
		});
		if (scenario === 'retained session' || scenario === 'nonce without proof') {
			await expect(database.uiState.get(`profileLock:${alice.profileId}`)).resolves.toMatchObject({
				value: true
			});
		}
	});

	test('keeps a household with pending local edits when sign-in discovers it', async () => {
		const database = await openDatabase();
		const household = (householdId: string, name: string, revision: number) =>
			({
				schemaVersion: 1,
				revision,
				createdAt: timestamp,
				updatedAt: timestamp,
				deletedAt: null,
				conflictClocks: {},
				householdId,
				name,
				locale: 'en-NL',
				timezone: 'Europe/Amsterdam',
				weekStartsOn: 1,
				defaultPlannedYield: 4,
				preferredDinnerTime: null,
				createdByUserId: 'user_alice',
				deletionState: 'active',
				localOnly: false
			}) as const;
		const edited = household('org_canal', 'Friday table', 2);
		const untouched = household('org_garden', 'Garden kitchen', 1);
		await database.households.bulkAdd([edited, untouched]);
		await database.outbox.add(
			queuedMutation(`signed-out:profile_alice`, {
				aggregateId: 'org_canal',
				entityKind: 'household'
			})
		);
		const discovered = (home: ReturnType<typeof household>) => ({
			household: home,
			membership: {
				membershipId: `membership_${home.householdId}`,
				householdId: home.householdId,
				workosUserId: 'user_alice',
				roleSlug: 'admin',
				permissions: ['households:write', 'meals:read', 'meals:write'],
				status: 'active',
				directoryManaged: false,
				workosCreatedAt: timestamp,
				lastVerifiedAt: timestamp,
				updatedAt: timestamp,
				detachedAt: null,
				denialCode: null,
				source: 'workos'
			},
			capability: {
				householdId: home.householdId,
				state: 'disabled',
				stripeStatus: null,
				subscriberUserId: null,
				stripePriceId: null,
				currentPeriodEnd: null,
				interruptionStartedAt: null,
				graceUntil: null,
				validUntil: null,
				cancelAtPeriodEnd: false,
				stale: false,
				source: 'stripe-d1'
			}
		});
		const fetcher = async () => {
			const body = (await authenticatedResponse(
				ALICE_SLOT,
				'user_alice',
				'Alice'
			).json()) as Record<string, unknown>;
			return Response.json({
				...body,
				households: [
					discovered(household('org_canal', 'Canal kitchen', 1)),
					discovered(household('org_garden', 'Garden table', 3))
				]
			});
		};

		await projectAuthCallback(
			database,
			{ authSlotId: ALICE_SLOT, authStatus: 'authenticated' },
			{ fetcher, now: timestamp }
		);

		await expect(database.households.get('org_canal')).resolves.toEqual(edited);
		await expect(database.households.get('org_garden')).resolves.toMatchObject({
			name: 'Garden table',
			revision: 3
		});
		await expect(database.memberships.get('membership_org_canal')).resolves.toBeDefined();
	});

	test('rolls back every projected store when the atomic write fails', async () => {
		const database = await openDatabase();
		await database.uiState.put({ key: 'activeProfileId', value: 'original-profile' });
		vi.spyOn(database.userAttributions, 'put').mockRejectedValueOnce(
			new Error('simulated attribution write failure')
		);

		await expect(
			projectAuthCallback(
				database,
				{ authSlotId: BOB_SLOT, authStatus: 'authenticated' },
				{ fetcher: async () => authenticatedResponse(BOB_SLOT, 'user_bob', 'Bob') }
			)
		).rejects.toThrow('simulated attribution write failure');

		await expect(database.profiles.count()).resolves.toBe(0);
		await expect(database.authSlots.count()).resolves.toBe(0);
		await expect(database.userAttributions.count()).resolves.toBe(0);
		await expect(database.uiState.get('activeProfileId')).resolves.toMatchObject({
			value: 'original-profile'
		});
		await expect(
			database.uiState.filter(({ key }) => key.startsWith('profileLock:')).count()
		).resolves.toBe(0);
	});

	test.each([
		['stale', 'stale'],
		['reauthRequired', 'reauthRequired']
	] as const)(
		'marks only the selected slot %s and keeps its local content',
		async (status, state) => {
			const database = await openDatabase();
			const alice = profile('user_alice', 'Alice');
			const bob = profile('user_bob', 'Bob');
			await database.profiles.bulkAdd([alice, bob]);
			await addSlot(database, alice, ALICE_SLOT);
			await addSlot(database, bob, BOB_SLOT);
			await database.recipes.add(localRecipe());

			const outcome = await projectAuthCallback(
				database,
				{ authSlotId: ALICE_SLOT, authStatus: 'authenticated' },
				{
					fetcher: async () =>
						new Response(JSON.stringify({ schemaVersion: 1, authSlotId: ALICE_SLOT, status }), {
							status: 200,
							headers: { 'content-type': 'application/json' }
						})
				}
			);

			expect(outcome).toMatchObject({ state, profileId: alice.profileId });
			await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
				authState: state
			});
			await expect(database.authSlots.get(ALICE_SLOT)).resolves.toMatchObject({
				sessionState: 'reauthRequired'
			});
			await expect(database.authSlots.get(BOB_SLOT)).resolves.toMatchObject({
				sessionState: 'authenticated'
			});
			await expect(database.recipes.count()).resolves.toBe(1);
		}
	);

	test('contains a failed selected-slot request to Alice', async () => {
		const database = await openDatabase();
		const alice = profile('user_alice', 'Alice');
		const bob = profile('user_bob', 'Bob');
		await database.profiles.bulkAdd([alice, bob]);
		await addSlot(database, alice, ALICE_SLOT);
		await addSlot(database, bob, BOB_SLOT);

		await expect(
			projectAuthCallback(
				database,
				{ authSlotId: ALICE_SLOT, authStatus: 'authenticated' },
				{ fetcher: async () => Promise.reject(new TypeError('offline')) }
			)
		).rejects.toBeInstanceOf(AuthSlotMetadataUnavailable);
		await expect(database.profiles.get(alice.profileId)).resolves.toMatchObject({
			authState: 'stale'
		});
		await expect(database.profiles.get(bob.profileId)).resolves.toMatchObject({
			authState: 'authenticated'
		});
		await expect(database.authSlots.get(BOB_SLOT)).resolves.toMatchObject({
			sessionState: 'authenticated'
		});
	});
});
