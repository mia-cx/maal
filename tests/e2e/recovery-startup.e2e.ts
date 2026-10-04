import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { BlobReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js';

configure({ useWebWorkers: false });

const databaseName = 'maal-v1:production';
const safeRecipeId = '01990c69-7f00-7000-8000-000000000077';
const damagedRecipeId = '01990c69-7f00-7000-8000-000000000078';

const seedRecoveryDatabase = async ({
	databaseName,
	safeRecipeId,
	damagedRecipeId,
	nativeVersion
}: {
	databaseName: string;
	safeRecipeId: string;
	damagedRecipeId: string;
	nativeVersion: number;
}) => {
	await new Promise<void>((resolve, reject) => {
		const deletion = indexedDB.deleteDatabase(databaseName);
		deletion.onerror = () => reject(deletion.error);
		deletion.onsuccess = () => resolve();
	});

	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open(databaseName, nativeVersion);
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

const downloadRecoveryArtifact = async (page: Page): Promise<Map<string, string>> => {
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download recovery archive' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^maal-recovery-user_alice-\d{4}-\d{2}-\d{2}\.zip$/);
	const path = await download.path();
	if (!path) throw new Error('The recovery download did not produce a local artifact.');
	const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])));
	const entries = new Map<string, string>();
	for (const entry of await reader.getEntries()) {
		if (!entry.directory) entries.set(entry.filename, await entry.getData(new TextWriter()));
	}
	await reader.close();
	return entries;
};

// The damaged recipe and the profile row without a user ID are skipped. The surviving recipe is
// a purged tombstone, so the archive is attributed to its owner but carries no recipe content.
const expectSafeRecoveryArtifact = async (page: Page, entries: Map<string, string>) => {
	const manifest = JSON.parse(entries.get('manifest.json') ?? '{}') as {
		exporterWorkosUserId?: string;
	};
	expect(manifest.exporterWorkosUserId).toBe('user_alice');
	expect([...entries.keys()]).toEqual(expect.arrayContaining(['recipes.json', 'meals.json']));
	expect([...entries.values()].join('\n')).not.toContain('never-export-this');
	await expect(
		page.getByText('Recovery archive saved. 2 unreadable records were skipped.')
	).toBeVisible();
};

const readRecoverySourceState = async (name: string) => {
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
};

const expectRecoveryShell = async (page: Page): Promise<void> => {
	await expect(page).toHaveURL(/\/recovery$/);
	await expect(page).toHaveTitle('Local data recovery · Maal');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Save your readable data first' })
	).toBeVisible();
	await expect(
		page.getByText('Your local data is ready for a read-only recovery export.')
	).toBeVisible();
};

test('newer schema startup falls back to a safe recovery artifact', async ({ page }) => {
	const contentRequests: string[] = [];
	page.on('request', (request) => {
		if (/\/api\/(?:sync|billing|auth|auth-slots)|\/mcp(?:\/|$)/.test(request.url())) {
			contentRequests.push(request.url());
		}
	});

	await page.goto('/manifest.webmanifest');
	await page.evaluate(seedRecoveryDatabase, {
		databaseName,
		safeRecipeId,
		damagedRecipeId,
		nativeVersion: 60
	});
	await page.goto('/plan');
	expect(await page.evaluate(() => indexedDB.databases())).toEqual([
		{ name: databaseName, version: 60 }
	]);

	await expectRecoveryShell(page);
	await expectSafeRecoveryArtifact(page, await downloadRecoveryArtifact(page));
	expect(contentRequests).toEqual([]);
	await expect
		.poll(() => page.evaluate(readRecoverySourceState, databaseName))
		.toEqual({ count: 2, version: 60 });

	await page.goto('/plan');
	await expect(page).toHaveURL(/\/recovery$/);
});

test('failed IndexedDB upgrade stays in recovery and exports safe data', async ({ page }) => {
	const injectedFailureKey = 'maal-e2e:failed-upgrade';
	await page.goto('/manifest.webmanifest');
	await page.evaluate(seedRecoveryDatabase, {
		databaseName,
		safeRecipeId,
		damagedRecipeId,
		nativeVersion: 50
	});
	await page.addInitScript(
		({ databaseName, injectedFailureKey }) => {
			const originalOpen = window.indexedDB.open.bind(window.indexedDB);
			window.indexedDB.open = ((name: string, version?: number) => {
				if (
					name === databaseName &&
					version !== undefined &&
					window.localStorage.getItem(injectedFailureKey) !== '1'
				) {
					window.localStorage.setItem(injectedFailureKey, '1');
					throw new DOMException('Injected IndexedDB upgrade failure.', 'AbortError');
				}
				return version === undefined ? originalOpen(name) : originalOpen(name, version);
			}) as typeof window.indexedDB.open;
		},
		{ databaseName, injectedFailureKey }
	);

	await page.goto('/plan');
	await expectRecoveryShell(page);
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), injectedFailureKey))
		.toBe('1');
	await expectSafeRecoveryArtifact(page, await downloadRecoveryArtifact(page));
	await expect
		.poll(() => page.evaluate(readRecoverySourceState, databaseName))
		.toEqual({ count: 2, version: 50 });

	await page.goto('/plan');
	await expect(page).toHaveURL(/\/recovery$/);
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), injectedFailureKey))
		.toBe('1');
});
