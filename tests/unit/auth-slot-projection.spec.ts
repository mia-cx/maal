import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { AuthSlotId } from '$lib/auth-slots/index.js';
import {
	AuthSlotMetadataUnavailable,
	projectAuthCallback,
	takeAuthCallbackMarker
} from '$lib/client/auth-slot-projection.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
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

const authenticatedResponse = (authSlotId: AuthSlotId, workosUserId: string, firstName: string) =>
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
