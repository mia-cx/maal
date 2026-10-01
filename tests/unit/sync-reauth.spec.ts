import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	createHouseholdSyncCoordinator,
	createUserSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncEnvironment,
	type UserSyncTransport
} from '$lib/client/sync/index.js';
import { ProfileSchema } from '$lib/domain/household/contracts.js';
import { SyncUnauthenticated } from '$lib/sync/contracts.js';

const timestamp = '2026-08-21T12:00:00.000Z' as const;
const authSlotId = 'a'.repeat(32);
const databases: MaalDatabase[] = [];

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

const environment: UserSyncEnvironment = {
	isOnline: () => true,
	isVisible: () => true,
	isSaveDataEnabled: () => false,
	on: () => () => undefined
};

const expired = async (): Promise<never> => {
	throw new SyncUnauthenticated({ code: 'expired', message: 'expired' });
};

const seedSignedInAlice = async (): Promise<{ database: MaalDatabase; profileId: string }> => {
	const database = await openMaalDatabase(`sync-reauth-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	await database.profiles.add(
		Schema.decodeUnknownSync(ProfileSchema)({
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
		})
	);
	await database.authSlots.add({
		authSlotId,
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

test.each([
	[
		'user',
		(database: MaalDatabase) => {
			const transport: UserSyncTransport = {
				pull: expired,
				push: expired,
				bootstrap: expired,
				backfill: expired
			};
			return createUserSyncCoordinator({
				database,
				authSlotId,
				workosUserId: 'user_alice',
				transport,
				environment,
				capabilityResolver: async () => ({ enabled: true, stale: false, householdId: 'org_home' })
			});
		}
	],
	[
		'household',
		(database: MaalDatabase) => {
			const transport: HouseholdSyncTransport = {
				pull: expired,
				push: expired,
				bootstrap: expired,
				backfill: expired
			};
			return createHouseholdSyncCoordinator({
				database,
				authSlotId,
				workosUserId: 'user_alice',
				householdId: 'org_home',
				transport,
				environment,
				capabilityResolver: async () => ({
					enabled: true,
					stale: false,
					membershipActive: true,
					permissions: ['meals:read', 'meals:write']
				})
			});
		}
	]
] as const)(
	'an expired session in %s sync asks the profile to reauthenticate',
	async (_scope, coordinatorFor) => {
		const { database, profileId } = await seedSignedInAlice();

		await expect(coordinatorFor(database).syncNow()).resolves.toBe('reauthRequired');

		await expect(database.profiles.get(profileId)).resolves.toMatchObject({
			authState: 'reauthRequired'
		});
		await expect(database.authSlots.get(authSlotId)).resolves.toMatchObject({
			sessionState: 'reauthRequired'
		});
	}
);
