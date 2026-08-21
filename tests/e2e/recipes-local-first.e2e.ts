import { expect, test } from '@playwright/test';

test('creates and reloads a recipe without content API requests', async ({ context, page }) => {
	const apiRequests: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
	});

	await page.goto('/menu');
	await expect(page.getByRole('button', { name: 'Add recipe' })).toBeVisible();
	await page.waitForFunction(async () =>
		(await indexedDB.databases()).some((candidate) => candidate.name?.startsWith('maal-v1:'))
	);
	await page.evaluate(async () => {
		const databaseInfo = await indexedDB.databases();
		const name = databaseInfo.find((candidate) => candidate.name?.startsWith('maal-v1:'))?.name;
		if (!name) throw new Error('Maal database was not initialized.');
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(['profiles', 'authSlots', 'uiState'], 'readwrite');
			transaction.objectStore('profiles').put({
				profileId: 'profile-alice',
				workosUserId: 'user_alice',
				displayName: 'Alice',
				email: 'alice@example.test',
				locale: 'en-US',
				timezone: 'Europe/Amsterdam',
				pinSalt: null,
				pinVerifier: null,
				lockPolicy: 'none',
				lastUsedAt: '2026-08-21T10:00:00.000Z',
				authState: 'authenticated'
			});
			transaction.objectStore('authSlots').put({
				authSlotId: 'slot-alice',
				profileId: 'profile-alice',
				workosUserId: 'user_alice',
				sessionState: 'authenticated',
				lastRefreshedAt: null,
				lastVerifiedAt: null,
				nextRetryAt: null,
				retryCount: 0
			});
			transaction.objectStore('uiState').put({ key: 'activeProfileId', value: 'profile-alice' });
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	});

	await page.reload();
	await page.getByRole('button', { name: 'Add recipe' }).click();
	await page.getByLabel('Title').fill('Offline tomato soup');
	await page.getByRole('textbox', { name: 'Ingredient 1', exact: true }).fill('tomatoes');

	await context.setOffline(true);
	await page.getByRole('button', { name: 'Save recipe' }).click();
	await expect(page.getByRole('button', { name: 'Open Offline tomato soup' })).toBeVisible();
	await context.setOffline(false);

	await page.reload();
	await expect(page.getByRole('button', { name: 'Open Offline tomato soup' })).toBeVisible();
	expect(apiRequests).toEqual([]);
});
