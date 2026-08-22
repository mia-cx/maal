import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const databaseName = 'maal-v1:production';
const safeRecipeId = '01990c69-7f00-7000-8000-000000000077';
const damagedRecipeId = '01990c69-7f00-7000-8000-000000000078';

const seedIncompatibleDatabase = async ({
	databaseName,
	safeRecipeId,
	damagedRecipeId
}: {
	databaseName: string;
	safeRecipeId: string;
	damagedRecipeId: string;
}) => {
	await new Promise<void>((resolve, reject) => {
		const deletion = indexedDB.deleteDatabase(databaseName);
		deletion.onerror = () => reject(deletion.error);
		deletion.onsuccess = () => resolve();
	});

	await new Promise<void>((resolve, reject) => {
		// The application currently opens IndexedDB version 50. A committed version 60 database
		// makes normal startup fail while leaving its stores available to schema-free recovery.
		const request = indexedDB.open(databaseName, 60);
		request.onerror = () => reject(request.error);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('recipes', { keyPath: 'id' });
			request.result.createObjectStore('profiles', { keyPath: 'profileId' });
			request.result.createObjectStore('authSlots', { keyPath: 'authSlotId' });
		};
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction(['recipes', 'profiles', 'authSlots'], 'readwrite');
			transaction.objectStore('recipes').put({
				schemaVersion: 1,
				revision: 2,
				createdAt: '2026-08-20T10:00:00.000Z',
				updatedAt: '2026-08-21T10:00:00.000Z',
				deletedAt: '2026-08-21T10:00:00.000Z',
				conflictClocks: {},
				id: safeRecipeId,
				ownerUserId: 'user_alice',
				purgedAt: '2026-08-21T10:00:00.000Z',
				retainUntil: '2027-08-21T10:00:00.000Z',
				purgeReason: 'permanent_delete',
				searchTokens: []
			});
			transaction.objectStore('recipes').put({ id: damagedRecipeId, title: 42 });
			transaction.objectStore('profiles').put({
				profileId: '01990c69-7f00-7000-8000-000000000079',
				pinSalt: 'never-export-this-pin-salt',
				pinVerifier: 'never-export-this-pin-verifier'
			});
			transaction.objectStore('authSlots').put({
				authSlotId: 'slot-alice',
				sealedSession: 'never-export-this-session'
			});
			transaction.onerror = () => reject(transaction.error);
			transaction.oncomplete = () => {
				database.close();
				resolve();
			};
		};
	});
};

test('failed schema startup falls back to a safe recovery artifact', async ({ page }) => {
	const contentRequests: string[] = [];
	page.on('request', (request) => {
		if (/\/api\/(?:sync|billing|auth|auth-slots)|\/mcp(?:\/|$)/.test(request.url())) {
			contentRequests.push(request.url());
		}
	});

	await page.goto('/manifest.webmanifest');
	await page.evaluate(seedIncompatibleDatabase, {
		databaseName,
		safeRecipeId,
		damagedRecipeId
	});
	await page.goto('/plan');
	expect(await page.evaluate(() => indexedDB.databases())).toEqual([
		{ name: databaseName, version: 60 }
	]);

	await expect(page).toHaveURL(/\/recovery$/);
	await expect(page).toHaveTitle('Local data recovery · Maal');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Save your readable data first' })
	).toBeVisible();
	await expect(
		page.getByText('Your local data is ready for a read-only recovery export.')
	).toBeVisible();

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download recovery JSON' }).click();
	const download = await downloadPromise;
	const path = await download.path();
	if (!path) throw new Error('The recovery download did not produce a local artifact.');
	const artifactText = await readFile(path, 'utf8');
	const artifact = JSON.parse(artifactText) as {
		databaseName: string;
		records: { recipes?: { id: string; ownerUserId: string }[] };
		skipped: { recipes?: number };
	};

	expect(artifact.databaseName).toBe(databaseName);
	expect(artifact.records.recipes).toEqual([
		expect.objectContaining({ id: safeRecipeId, ownerUserId: 'user_alice' })
	]);
	expect(artifact.skipped.recipes).toBe(1);
	expect(artifactText).not.toContain('never-export-this');
	expect(contentRequests).toEqual([]);

	await expect
		.poll(() =>
			page.evaluate(async (name) => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open(name);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const count = await new Promise<number>((resolve, reject) => {
					const request = database.transaction('recipes').objectStore('recipes').count();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const result = { count, version: database.version };
				database.close();
				return result;
			}, databaseName)
		)
		.toEqual({ count: 2, version: 60 });

	await page.goto('/plan');
	await expect(page).toHaveURL(/\/recovery$/);
});
