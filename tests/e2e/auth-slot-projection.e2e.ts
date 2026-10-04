import { expect, test, type Page } from '@playwright/test';

const ALICE_SLOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB_SLOT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ALICE_PROFILE = '01990c69-7f00-7000-8000-000000000001';
const BOB_PROFILE = '01990c69-7f00-7000-8000-000000000002';
const timestamp = '2026-08-22T09:00:00.000Z';

const resetDatabase = async () => {
	const databaseName = 'maal-v1:production';
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
};

const seedProfiles = async (options: { includeBob: boolean; aliceNeedsReauth: boolean }) => {
	const databaseName = 'maal-v1:production';
	const aliceSlot = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const bobSlot = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
	const aliceProfile = '01990c69-7f00-7000-8000-000000000001';
	const bobProfile = '01990c69-7f00-7000-8000-000000000002';
	const seededAt = '2026-08-22T09:00:00.000Z';
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	const transaction = database.transaction(
		['profiles', 'authSlots', 'recipes', 'uiState'],
		'readwrite'
	);
	const profiles = transaction.objectStore('profiles');
	const slots = transaction.objectStore('authSlots');
	profiles.put({
		profileId: aliceProfile,
		workosUserId: 'user_alice',
		displayName: 'Alice de Vries',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: 'alice-pin-salt',
		pinVerifier: 'alice-pin-verifier',
		lockPolicy: 'pin',
		lastUsedAt: seededAt,
		authState: options.aliceNeedsReauth ? 'reauthRequired' : 'authenticated'
	});
	slots.put({
		authSlotId: aliceSlot,
		profileId: aliceProfile,
		workosUserId: 'user_alice',
		sessionState: options.aliceNeedsReauth ? 'reauthRequired' : 'authenticated',
		lastRefreshedAt: seededAt,
		lastVerifiedAt: seededAt,
		nextRetryAt: null,
		retryCount: 0
	});
	if (options.includeBob) {
		profiles.put({
			profileId: bobProfile,
			workosUserId: 'user_bob',
			displayName: 'Bob de Vries',
			email: 'bob@example.test',
			profilePictureUrl: null,
			locale: 'en-NL',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: seededAt,
			authState: 'authenticated'
		});
		slots.put({
			authSlotId: bobSlot,
			profileId: bobProfile,
			workosUserId: 'user_bob',
			sessionState: 'authenticated',
			lastRefreshedAt: seededAt,
			lastVerifiedAt: seededAt,
			nextRetryAt: null,
			retryCount: 0
		});
	}
	transaction.objectStore('recipes').put({
		id: '01990c69-7f00-7000-8000-000000000099',
		ownerUserId: 'user_alice',
		schemaVersion: 1,
		revision: 1,
		createdAt: seededAt,
		updatedAt: seededAt,
		deletedAt: null,
		conflictClocks: {}
	});
	transaction.objectStore('uiState').put({
		key: 'activeProfileId',
		value: options.includeBob ? bobProfile : aliceProfile
	});
	transaction.objectStore('uiState').put({ key: `profileLock:${aliceProfile}`, value: true });
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

const prepareDatabase = async (page: Page, includeBob = false, aliceNeedsReauth = false) => {
	await page.goto('/');
	await page.evaluate(resetDatabase);
	await page.goto('/plan');
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const databaseName = 'maal-v1:production';
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open(databaseName);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const ready = database.objectStoreNames.contains('userAttributions');
				database.close();
				return ready;
			})
		)
		.toBe(true);
	await page.evaluate(seedProfiles, { includeBob, aliceNeedsReauth });
};

const readProjection = async (page: Page) =>
	page.evaluate(async () => {
		const databaseName = 'maal-v1:production';
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const transaction = database.transaction(
			['profiles', 'authSlots', 'recipes', 'uiState'],
			'readonly'
		);
		const all = <T>(store: string) =>
			new Promise<T[]>((resolve, reject) => {
				const request = transaction.objectStore(store).getAll();
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result as T[]);
			});
		const get = <T>(store: string, key: string) =>
			new Promise<T | undefined>((resolve, reject) => {
				const request = transaction.objectStore(store).get(key);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result as T | undefined);
			});
		const [profiles, slots, recipes, active] = await Promise.all([
			all<Record<string, unknown>>('profiles'),
			all<Record<string, unknown>>('authSlots'),
			all<Record<string, unknown>>('recipes'),
			get<{ value: unknown }>('uiState', 'activeProfileId')
		]);
		database.close();
		return { profiles, slots, recipes, activeProfileId: active?.value };
	});

const metadata = (slot: string, userId: string, firstName: string) => ({
	schemaVersion: 1,
	authSlotId: slot,
	status: 'authenticated',
	workosUserId: userId,
	email: `${firstName.toLowerCase()}@example.test`,
	firstName,
	lastName: 'de Vries',
	profilePictureUrl: null,
	verifiedAt: timestamp
});

test('adds Bob from the callback once and keeps Alice retained independently', async ({ page }) => {
	await prepareDatabase(page);
	const authRequests: string[] = [];
	let urlAtRequest = '';
	await page.route(`**/api/auth-slots/${BOB_SLOT}/`, async (route) => {
		authRequests.push(route.request().url());
		urlAtRequest = page.url();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(metadata(BOB_SLOT, 'user_bob', 'Bob'))
		});
	});

	await page.goto(`/plan?authSlot=${BOB_SLOT}&authStatus=authenticated&view=week`);
	await expect
		.poll(async () => ({
			profiles: (await readProjection(page)).profiles.length,
			requests: authRequests.length,
			url: page.url()
		}))
		.toMatchObject({ profiles: 2, requests: 1 });
	expect(new URL(page.url()).searchParams.has('authSlot')).toBe(false);
	expect(new URL(page.url()).searchParams.get('view')).toBe('week');
	expect(new URL(urlAtRequest).searchParams.has('authSlot')).toBe(false);
	const projection = await readProjection(page);
	expect(projection.slots).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ authSlotId: ALICE_SLOT, workosUserId: 'user_alice' }),
			expect.objectContaining({ authSlotId: BOB_SLOT, workosUserId: 'user_bob' })
		])
	);
	expect(projection.activeProfileId).toBe(
		projection.profiles.find(({ workosUserId }) => workosUserId === 'user_bob')?.profileId
	);
	expect(projection.recipes).toHaveLength(1);

	await page.reload();
	await page.waitForTimeout(100);
	expect(authRequests).toHaveLength(1);
	expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sealedSession');
});

test('reauthenticates Alice without changing Bob retained state', async ({ page }) => {
	await prepareDatabase(page, true, true);
	await page.route(`**/api/auth-slots/${ALICE_SLOT}/`, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(metadata(ALICE_SLOT, 'user_alice', 'Alice'))
		})
	);

	await page.goto(`/plan?authSlot=${ALICE_SLOT}&authStatus=authenticated`);
	await expect.poll(async () => (await readProjection(page)).activeProfileId).toBe(ALICE_PROFILE);
	const projection = await readProjection(page);
	expect(projection.profiles).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				profileId: ALICE_PROFILE,
				authState: 'authenticated',
				pinSalt: 'alice-pin-salt'
			}),
			expect.objectContaining({ profileId: BOB_PROFILE, authState: 'authenticated' })
		])
	);
	expect(projection.slots).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ authSlotId: ALICE_SLOT, sessionState: 'authenticated' }),
			expect.objectContaining({ authSlotId: BOB_SLOT, sessionState: 'authenticated' })
		])
	);
});

test('uses the real selected-slot Worker route to contain a missing or revoked session', async ({
	page
}) => {
	await prepareDatabase(page, true);
	const apiRequests: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
	});

	await page.goto(`/plan?authSlot=${ALICE_SLOT}&authStatus=authenticated`);
	await expect(page.getByRole('alert')).toContainText('needs to sign in again');
	const projection = await readProjection(page);
	expect(projection.profiles).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ profileId: ALICE_PROFILE, authState: 'reauthRequired' }),
			expect.objectContaining({ profileId: BOB_PROFILE, authState: 'authenticated' })
		])
	);
	expect(projection.slots).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ authSlotId: ALICE_SLOT, sessionState: 'reauthRequired' }),
			expect.objectContaining({ authSlotId: BOB_SLOT, sessionState: 'authenticated' })
		])
	);
	expect(projection.recipes).toHaveLength(1);
	expect(apiRequests.map((url) => new URL(url).pathname)).toEqual([
		`/api/auth-slots/${ALICE_SLOT}/`
	]);
});
