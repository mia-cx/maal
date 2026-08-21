import { expect, test, type Page } from '@playwright/test';

const resetDatabase = async () => {
	const databaseName = 'maal-v1:production';
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
};

const seedCurrentDatabase = async () => {
	const databaseName = 'maal-v1:production';
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	const requiredStores = ['profiles', 'authSlots', 'households', 'memberships', 'uiState'];
	const missingStores = requiredStores.filter(
		(store) => !database.objectStoreNames.contains(store)
	);
	if (missingStores.length > 0) {
		throw new Error(
			`Missing stores ${missingStores.join(', ')}; available: ${Array.from(database.objectStoreNames).join(', ')}`
		);
	}
	const transaction = database.transaction(requiredStores, 'readwrite');
	const timestamp = '2026-08-21T12:00:00.000Z';
	const aliceProfileId = '01990c69-7f00-7000-8000-000000000001';
	const bobProfileId = '01990c69-7f00-7000-8000-000000000002';
	transaction.objectStore('profiles').put({
		profileId: aliceProfileId,
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
	transaction.objectStore('profiles').put({
		profileId: bobProfileId,
		workosUserId: 'user_bob',
		displayName: 'Bob de Vries',
		email: 'bob@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: timestamp,
		authState: 'authenticated'
	});
	transaction.objectStore('authSlots').put({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		profileId: aliceProfileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	transaction.objectStore('authSlots').put({
		authSlotId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		profileId: bobProfileId,
		workosUserId: 'user_bob',
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	transaction.objectStore('households').put({
		schemaVersion: 1,
		revision: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		deletedAt: null,
		conflictClocks: {},
		householdId: 'org_canal_kitchen',
		name: 'Canal kitchen',
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		weekStartsOn: 1,
		defaultPlannedYield: 4,
		preferredDinnerTime: '18:30',
		createdByUserId: 'user_alice',
		deletionState: 'active',
		localOnly: false
	});
	const permissions = [
		'households:write',
		'recipes:read',
		'recipes:write',
		'meals:read',
		'meals:write'
	];
	for (const [membershipId, workosUserId, roleSlug] of [
		['membership_alice', 'user_alice', 'admin'],
		['membership_bob', 'user_bob', 'member']
	]) {
		transaction.objectStore('memberships').put({
			membershipId,
			householdId: 'org_canal_kitchen',
			workosUserId,
			roleSlug,
			permissions,
			status: 'active',
			directoryManaged: false,
			workosCreatedAt: timestamp,
			lastVerifiedAt: timestamp,
			updatedAt: timestamp,
			detachedAt: null,
			denialCode: null,
			source: 'workos'
		});
	}
	transaction.objectStore('uiState').put({ key: 'activeProfileId', value: aliceProfileId });
	transaction.objectStore('uiState').put({
		key: `activeHouseholdId:${aliceProfileId}`,
		value: 'org_canal_kitchen'
	});
	transaction.objectStore('uiState').put({
		key: `activeHouseholdId:${bobProfileId}`,
		value: 'org_canal_kitchen'
	});
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

const seedProfilesAndHousehold = async (page: Page) => {
	await page.goto('/');
	await page.evaluate(resetDatabase);
	await page.goto('/household');
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('maal-v1:production');
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const ready =
					database.version === 50 &&
					['profiles', 'authSlots', 'households', 'memberships', 'uiState'].every((store) =>
						database.objectStoreNames.contains(store)
					);
				database.close();
				return ready;
			})
		)
		.toBe(true);
	await page.evaluate(seedCurrentDatabase);
	await page.reload();
};

test('switches real local profiles with a PIN and changes household data without remote content requests', async ({
	page
}) => {
	const remoteRequests: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) remoteRequests.push(request.url());
	});
	await seedProfilesAndHousehold(page);

	await expect(page.getByRole('heading', { name: 'Household settings' })).toBeVisible();
	await expect(page.getByLabel('Name')).toHaveValue('Canal kitchen');

	await page.getByRole('button', { name: /AD Alice de Vries alice@example\.test/ }).click();
	await page.getByRole('menuitem', { name: /Set profile PIN/ }).click();
	await page.getByPlaceholder('4 to 8 numbers').fill('4826');
	await page.getByRole('button', { name: 'Save PIN' }).click();

	await page.getByRole('button', { name: /AD Alice de Vries alice@example\.test/ }).click();
	await page.getByRole('menuitem', { name: /Bob de Vries/ }).click();
	await expect(
		page.getByRole('button', { name: /BD Bob de Vries bob@example\.test/ })
	).toBeVisible();
	await page.getByRole('button', { name: /BD Bob de Vries bob@example\.test/ }).click();
	await page.getByRole('menuitem', { name: /Alice de Vries/ }).click();
	await expect(page.getByRole('heading', { name: 'Open Alice de Vries' })).toBeVisible();
	await page.getByLabel('Profile PIN').fill('4826');
	await page.getByRole('button', { name: 'Open profile' }).click();
	await expect(
		page.getByRole('button', { name: /AD Alice de Vries alice@example\.test/ })
	).toBeVisible();

	const name = page.getByLabel('Name');
	await name.fill('Friday table');
	await page.getByRole('button', { name: 'Save household' }).click();
	await expect(name).toHaveValue('Friday table');
	await expect(page.getByText('Household settings saved.')).toBeVisible();
	expect(remoteRequests).toEqual([]);
});

test('keeps the approved household layout usable at kitchen-tablet and phone widths', async ({
	page
}) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	await seedProfilesAndHousehold(page);
	await expect(page.getByRole('heading', { name: 'Household settings' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole('heading', { name: 'Household settings' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save household' })).toBeVisible();
});
