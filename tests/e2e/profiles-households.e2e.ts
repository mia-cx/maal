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

test('a locked profile hides its data until its PIN or a fresh sign-in opens it', async ({
	page
}) => {
	await seedProfilesAndHousehold(page);
	const alice = page.getByRole('button', { name: /AD Alice de Vries alice@example\.test/ });
	const lockScreen = page.getByRole('heading', { name: 'Open Alice de Vries' });
	const setPin = async (pin: string) => {
		await page.getByPlaceholder('4 to 8 numbers').fill(pin);
		await page.getByRole('button', { name: 'Save PIN' }).click();
	};
	const lock = async () => {
		await alice.click();
		await page.getByRole('menuitem', { name: 'Lock profile' }).click();
		await expect(lockScreen).toBeVisible();
	};

	await alice.click();
	await page.getByRole('menuitem', { name: /Set profile PIN/ }).click();
	await setPin('4826');
	await lock();
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(0);
	await page.reload();
	await expect(lockScreen).toBeVisible();
	await expect(page.getByText('Canal kitchen')).toHaveCount(0);

	await page.getByLabel('Profile PIN').fill('1111');
	await page.getByRole('button', { name: 'Open profile' }).click();
	await expect(page.getByText('That PIN did not match.')).toBeVisible();
	await page.getByLabel('Profile PIN').fill('4826');
	await page.getByRole('button', { name: 'Open profile' }).click();
	await expect(page.getByLabel('Name')).toHaveValue('Canal kitchen');

	await alice.click();
	await page.getByRole('menuitem', { name: /Change profile PIN/ }).click();
	await setPin('1234');
	await expect(page.getByText('Enter the current PIN.')).toBeVisible();
	await page.getByLabel('Current PIN').fill('4826');
	await setPin('1234');
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await lock();
	await page.route('**/api/auth-slots/*/authorize?**', (route) =>
		route.fulfill({ status: 200, contentType: 'text/plain', body: 'WorkOS sign-in' })
	);
	await page.getByRole('button', { name: 'Forgot PIN?' }).click();
	await expect(page).toHaveURL(
		/\/api\/auth-slots\/a{32}\/authorize\?purpose=reauthenticate&returnTo=%2Fplan&pinResetNonce=[0-9a-f]{32}$/
	);
});

test('removes the only local profile from the lock screen only after confirmation', async ({
	page
}) => {
	await seedProfilesAndHousehold(page);
	await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('maal-v1:production');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const transaction = database.transaction(['profiles', 'authSlots'], 'readwrite');
		transaction.objectStore('profiles').delete('01990c69-7f00-7000-8000-000000000002');
		transaction.objectStore('authSlots').delete('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	});
	await page.reload();

	const alice = page.getByRole('button', { name: /AD Alice de Vries alice@example\.test/ });
	await alice.click();
	await page.getByRole('menuitem', { name: /Set profile PIN/ }).click();
	await page.getByPlaceholder('4 to 8 numbers').fill('4826');
	await page.getByRole('button', { name: 'Save PIN' }).click();
	await alice.click();
	await page.getByRole('menuitem', { name: 'Lock profile' }).click();
	await expect(page.getByRole('heading', { name: 'Open Alice de Vries' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Open Alice de Vries' })).toBeVisible();
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(0);
	await expect(page.getByText('Other profiles', { exact: true })).toHaveCount(0);

	let removalRequests = 0;
	await page.route('**/api/auth-slots/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', async (route) => {
		removalRequests += 1;
		expect(route.request().method()).toBe('DELETE');
		await route.fulfill({ status: removalRequests === 1 ? 503 : 204 });
	});
	const remove = page.getByRole('button', { name: 'Remove from this device', exact: true });
	const dialog = page.getByRole('dialog', {
		name: 'Remove Alice de Vries from this device?'
	});
	await remove.click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Export data first' })).toHaveCount(0);
	expect(removalRequests).toBe(0);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Open Alice de Vries' })).toBeVisible();
	expect(removalRequests).toBe(0);

	await remove.click();
	await dialog.getByRole('button', { name: 'Remove from this device' }).click();
	await expect(dialog.getByRole('alert')).toHaveText(
		'This profile could not be removed. Check the connection and try again.'
	);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Open Alice de Vries' })).toBeVisible();
	await remove.click();
	await dialog.getByRole('button', { name: 'Remove from this device' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Add a profile' })).toBeVisible();
	expect(removalRequests).toBe(2);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Add a profile' })).toBeVisible();
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

test('leaves through the auth-slot client path while preserving both local profiles and the snapshot', async ({
	page
}) => {
	await seedProfilesAndHousehold(page);
	await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('maal-v1:production');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const transaction = database.transaction('memberships', 'readwrite');
		const store = transaction.objectStore('memberships');
		const bob = await new Promise<Record<string, unknown>>((resolve, reject) => {
			const request = store.get('membership_bob');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result as Record<string, unknown>);
		});
		store.put({ ...bob, roleSlug: 'admin' });
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	});
	await page.reload();

	const leavePath =
		'/api/auth-slots/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/households/org_canal_kitchen/membership';
	let leaveRequests = 0;
	await page.route(`**${leavePath}`, async (route) => {
		leaveRequests += 1;
		expect(route.request().method()).toBe('DELETE');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				schemaVersion: 1,
				payload: {
					householdId: 'org_canal_kitchen',
					membershipId: 'membership_alice',
					removed: true
				}
			})
		});
	});

	await page.getByRole('button', { name: 'Leave household' }).click();
	const dialog = page.getByRole('dialog', { name: 'Leave household?' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Leave household' }).click();
	await expect(page.getByRole('heading', { name: 'Detached household snapshot' })).toBeVisible();
	expect(leaveRequests).toBe(1);

	await page.getByRole('button', { name: /AD Alice de Vries alice@example\.test/ }).click();
	await page.getByRole('menuitem', { name: /Bob de Vries/ }).click();
	await expect(
		page.getByRole('button', { name: /BD Bob de Vries bob@example\.test/ })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Household settings' })).toBeVisible();
});
