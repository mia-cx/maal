import Dexie from 'dexie';
import { afterEach, expect, test, vi } from 'vitest';

import type { AuthSlotId } from '$lib/auth-slots/index.js';
import { projectAuthCallback, takeAuthCallbackMarker } from '$lib/client/auth-slot-projection.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';

const SLOT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as AuthSlotId;
const timestamp = '2026-08-22T09:00:00.000Z' as const;
const databases: MaalDatabase[] = [];

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all(databases.map((database) => Dexie.delete(database.name)));
	databases.length = 0;
});

test('consumes and projects an added profile in a real browser IndexedDB', async () => {
	const database = await openMaalDatabase(`auth-browser-${crypto.randomUUID()}`);
	databases.push(database);
	const replacements: string[] = [];
	const marker = takeAuthCallbackMarker(
		new URL(`https://maal.test/plan?authSlot=${SLOT}&authStatus=authenticated`),
		(url) => replacements.push(url)
	);
	expect(marker).not.toBeNull();

	const fetcher = vi.fn(async () =>
		Response.json({
			schemaVersion: 1,
			authSlotId: SLOT,
			status: 'authenticated',
			workosUserId: 'user_bob',
			email: 'bob@example.test',
			firstName: 'Bob',
			lastName: null,
			profilePictureUrl: null,
			verifiedAt: timestamp
		})
	);
	await projectAuthCallback(database, marker!, {
		fetcher,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		now: timestamp
	});

	expect(replacements).toEqual(['/plan']);
	expect(fetcher).toHaveBeenCalledOnce();
	await expect(
		database.profiles.where('workosUserId').equals('user_bob').first()
	).resolves.toMatchObject({
		displayName: 'Bob',
		authState: 'authenticated'
	});
	await expect(database.authSlots.get(SLOT)).resolves.toMatchObject({
		workosUserId: 'user_bob',
		sessionState: 'authenticated'
	});
});
