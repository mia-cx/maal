#!/usr/bin/env node
import { chromium } from '@playwright/test';

import { validateStagingOrigin } from './lib/staging-cutover-proof.mjs';

const baseUrl = validateStagingOrigin(process.env.MAAL_STAGING_BASE_URL);
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const contentRequests = [];
const pageErrors = [];

page.on('pageerror', (error) => pageErrors.push(error.name));
context.on('request', (request) => {
	const pathname = new URL(request.url()).pathname;
	if (
		pathname === '/mcp' ||
		/^\/api\/auth-slots\/[^/]+\/(?:sync|billing|mcp-keys|recipes\/import-url)(?:\/|$)/.test(
			pathname
		) ||
		pathname.startsWith('/api/billing/')
	) {
		contentRequests.push({ method: request.method(), routeClass: classify(pathname) });
	}
});

try {
	await page.goto(`${baseUrl}/menu`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(async () =>
		(await indexedDB.databases()).some((candidate) => candidate.name?.startsWith('maal-v1:'))
	);
	await seedFreeProfile(page);
	await page.reload();
	await page.getByRole('button', { name: 'Add recipe' }).click();
	await page.getByLabel('Title').fill('Disposable local-only soup');
	await page.getByRole('textbox', { name: 'Ingredient 1', exact: true }).fill('tomatoes');
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Save recipe' }).click();
	await page.getByRole('button', { name: 'Open Disposable local-only soup' }).waitFor();
	await context.setOffline(false);
	await page.reload();
	await page.getByRole('button', { name: 'Open Disposable local-only soup' }).waitFor();
	if (contentRequests.length > 0) {
		throw new Error(`Free-use proof observed ${contentRequests.length} paid content requests.`);
	}
	if (pageErrors.length > 0)
		throw new Error(`Free-use proof observed ${pageErrors.length} page errors.`);
	process.stdout.write(
		`${JSON.stringify(
			{
				result: 'passed',
				checks: {
					localRecipeCreatedOffline: true,
					localRecipeReopenedOnline: true,
					zeroPaidContentRequests: true,
					zeroPageErrors: true
				},
				observed: { paidContentRequestCount: 0, pageErrorCount: 0 },
				secretsPrinted: false,
				personalDataPrinted: false
			},
			null,
			2
		)}\n`
	);
} finally {
	await context.close();
	await browser.close();
}

function classify(pathname) {
	if (pathname === '/mcp') return 'mcp';
	if (pathname.startsWith('/api/billing/')) return 'billing-platform';
	if (pathname.includes('/sync/')) return 'sync';
	if (pathname.includes('/billing/')) return 'billing-slot';
	if (pathname.includes('/mcp-keys')) return 'mcp-keys';
	return 'remote-recipe-import';
}

async function seedFreeProfile(target) {
	await target.evaluate(async () => {
		const databaseInfo = await indexedDB.databases();
		const name = databaseInfo.find((candidate) => candidate.name?.startsWith('maal-v1:'))?.name;
		if (!name) throw new Error('Maal database was not initialized.');
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(['profiles', 'authSlots', 'uiState'], 'readwrite');
			transaction.objectStore('profiles').put({
				profileId: 'proof-local-profile',
				workosUserId: 'proof-local-user',
				displayName: 'Local proof profile',
				email: 'local-proof@example.test',
				profilePictureUrl: null,
				locale: 'en-US',
				timezone: 'Europe/Amsterdam',
				pinSalt: null,
				pinVerifier: null,
				lockPolicy: 'none',
				lastUsedAt: new Date().toISOString(),
				authState: 'localOnly'
			});
			transaction.objectStore('authSlots').put({
				authSlotId: 'proof-local-slot',
				profileId: 'proof-local-profile',
				workosUserId: 'proof-local-user',
				sessionState: 'localOnly',
				lastRefreshedAt: null,
				lastVerifiedAt: null,
				nextRetryAt: null,
				retryCount: 0
			});
			transaction.objectStore('uiState').put({
				key: 'activeProfileId',
				value: 'proof-local-profile'
			});
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	});
}
