import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

const databaseName = 'maal-v1:production';

const seedLocalProfile = async (name: string) => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(['profiles', 'authSlots', 'uiState'], 'readwrite');
		transaction.objectStore('profiles').put({
			profileId: 'profile-quota-proof',
			workosUserId: 'user_quota_proof',
			displayName: 'Quota proof',
			email: 'quota@example.test',
			profilePictureUrl: null,
			locale: 'en-US',
			timezone: 'Europe/Amsterdam',
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: '2026-08-22T08:00:00.000Z',
			authState: 'authenticated'
		});
		transaction.objectStore('authSlots').put({
			authSlotId: 'slot-quota-proof',
			profileId: 'profile-quota-proof',
			workosUserId: 'user_quota_proof',
			sessionState: 'authenticated',
			lastRefreshedAt: null,
			lastVerifiedAt: null,
			nextRetryAt: null,
			retryCount: 0
		});
		transaction.objectStore('uiState').put({
			key: 'activeProfileId',
			value: 'profile-quota-proof'
		});
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

const createRecipe = async (page: Page, title: string): Promise<void> => {
	await page.getByRole('button', { name: 'Add recipe' }).click();
	await page.getByLabel('Title').fill(title);
	await page.getByRole('textbox', { name: 'Ingredient 1', exact: true }).fill('lentils');
	await page.getByRole('button', { name: 'Save recipe' }).click();
};

const localCommandCounts = async (name: string) => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	const transaction = database.transaction(['recipes', 'outbox']);
	const count = (store: string) =>
		new Promise<number>((resolve, reject) => {
			const request = transaction.objectStore(store).count();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
	const result = { recipes: await count('recipes'), outbox: await count('outbox') };
	database.close();
	return result;
};

test('quota aborts a command atomically and leaves recovery export usable', async ({ page }) => {
	const quotaFailureKey = 'maal-e2e:quota-on-outbox';
	await page.addInitScript((failureKey) => {
		const add = IDBObjectStore.prototype.add;
		IDBObjectStore.prototype.add = function (
			this: IDBObjectStore,
			value: unknown,
			key?: IDBValidKey
		): IDBRequest<IDBValidKey> {
			if (this.name === 'outbox' && localStorage.getItem(failureKey) === '1') {
				throw new DOMException('Injected browser quota exhaustion.', 'QuotaExceededError');
			}
			return key === undefined ? add.call(this, value) : add.call(this, value, key);
		};
	}, quotaFailureKey);
	await page.goto('/menu');
	await page.waitForFunction(async (name) => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const ready = ['profiles', 'authSlots', 'uiState'].every((store) =>
			database.objectStoreNames.contains(store)
		);
		database.close();
		return ready;
	}, databaseName);
	await expect
		.poll(() =>
			page.evaluate(async (name) => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open(name);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const stores = [...database.objectStoreNames];
				database.close();
				return stores;
			}, databaseName)
		)
		.toEqual(expect.arrayContaining(['profiles', 'authSlots', 'uiState']));
	await page.evaluate(seedLocalProfile, databaseName);
	await page.reload();

	await createRecipe(page, 'Saved before quota');
	await expect(page.getByRole('button', { name: 'Open Saved before quota' })).toBeVisible();
	await expect
		.poll(() => page.evaluate(localCommandCounts, databaseName))
		.toEqual({
			recipes: 1,
			outbox: 1
		});

	await page.evaluate((key) => localStorage.setItem(key, '1'), quotaFailureKey);
	await createRecipe(page, 'Must not partially save');
	await expect(
		page.getByText('The device has no storage available. No local changes were saved.')
	).toBeVisible();
	await expect
		.poll(() => page.evaluate(localCommandCounts, databaseName))
		.toEqual({
			recipes: 1,
			outbox: 1
		});

	await page.goto('/recovery');
	await expect(
		page.getByText('Your local data is ready for a read-only recovery export.')
	).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download recovery JSON' }).click();
	const download = await downloadPromise;
	const path = await download.path();
	if (!path) throw new TypeError('The recovery download did not produce an artifact.');
	const artifact = await readFile(path, 'utf8');
	expect(artifact).toContain('Saved before quota');
	expect(artifact).not.toContain('Must not partially save');
});
