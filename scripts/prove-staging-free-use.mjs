#!/usr/bin/env node
import { chromium } from '@playwright/test';

import {
	classifyPermittedFreeUseCall,
	validateStagingOrigin
} from './lib/staging-cutover-proof.mjs';

const baseUrl = validateStagingOrigin(process.env.MAAL_STAGING_BASE_URL);
const browser = await chromium.launch();
const d1OpenCount = Number(process.env.MAAL_STAGING_FREE_D1_OPEN_COUNT);
if (!Number.isSafeInteger(d1OpenCount) || d1OpenCount !== 0) {
	throw new Error('Free-use proof requires operator-confirmed MAAL_STAGING_FREE_D1_OPEN_COUNT=0.');
}
const context = await browser.newContext({
	extraHTTPHeaders: {
		'x-maal-proof-trace': process.env.MAAL_STAGING_DEPLOYMENT_LABEL ?? 'staging-free-use-proof'
	}
});
const page = await context.newPage();
const remoteRequests = [];
const pageErrors = [];

page.on('pageerror', (error) => pageErrors.push(error.name));
context.on('request', (request) => {
	const url = new URL(request.url());
	if (url.origin !== baseUrl || (!url.pathname.startsWith('/api/') && url.pathname !== '/mcp'))
		return;
	remoteRequests.push({
		method: request.method(),
		routeClass: classifyPermittedFreeUseCall(request.method(), url.pathname)
	});
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
	const unpermittedRequests = remoteRequests.filter(({ routeClass }) => routeClass === null);
	if (unpermittedRequests.length > 0) {
		throw new Error(
			`Free-use proof observed ${unpermittedRequests.length} unpermitted remote calls.`
		);
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
					zeroUnpermittedRemoteCalls: true,
					zeroD1OpensObserved: true,
					zeroPageErrors: true
				},
				observed: {
					permittedAuthCallCount: countClass('auth'),
					permittedBillingCallCount: countClass('billing'),
					permittedAdminCallCount: countClass('admin'),
					unpermittedRemoteCallCount: 0,
					d1OpenCount,
					pageErrorCount: 0
				},
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

function countClass(routeClass) {
	return remoteRequests.filter((request) => request.routeClass === routeClass).length;
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
