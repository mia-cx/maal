import { expect, test, type Page } from '@playwright/test';

const databaseName = 'maal-v1:production';

const controllerScript = async (page: Page): Promise<string> => {
	try {
		return (await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)) ?? '';
	} catch {
		return '';
	}
};

const seedLocalProfile = async (name: string) => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(['profiles', 'authSlots', 'uiState'], 'readwrite');
		transaction.objectStore('profiles').put({
			profileId: 'profile-update-proof',
			workosUserId: 'user_update_proof',
			displayName: 'Update proof',
			email: 'update@example.test',
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
			authSlotId: 'slot-update-proof',
			profileId: 'profile-update-proof',
			workosUserId: 'user_update_proof',
			sessionState: 'authenticated',
			lastRefreshedAt: null,
			lastVerifiedAt: null,
			nextRetryAt: null,
			retryCount: 0
		});
		transaction.objectStore('uiState').put({
			key: 'activeProfileId',
			value: 'profile-update-proof'
		});
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

test('two tabs drain and acknowledge before a worker update reloads a saved local commit', async ({
	context,
	page
}) => {
	const protocol: Array<{ type: string; tabId?: string }> = [];
	const pageErrors: string[] = [];
	await context.exposeBinding('recordPwaProofMessage', (_source, message: unknown) => {
		if (
			typeof message === 'object' &&
			message !== null &&
			'type' in message &&
			typeof message.type === 'string'
		) {
			protocol.push({
				type: message.type,
				tabId: 'tabId' in message && typeof message.tabId === 'string' ? message.tabId : undefined
			});
		}
	});
	await context.addInitScript(() => {
		const channel = new BroadcastChannel('maal-pwa-updates-v1');
		channel.addEventListener('message', (event) => {
			void (
				window as typeof window & {
					recordPwaProofMessage: (message: unknown) => Promise<void>;
				}
			).recordPwaProofMessage(event.data);
		});
	});
	page.on('pageerror', (error) => pageErrors.push(error.message));

	await page.goto('/menu');
	await page.evaluate(async () => navigator.serviceWorker.ready.then(() => undefined));
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);
	await page.evaluate(seedLocalProfile, databaseName);
	protocol.length = 0;
	await page.reload();

	await page.getByRole('button', { name: 'Add recipe' }).click();
	await page.getByLabel('Title').fill('Update-safe lentil soup');
	await page.getByRole('textbox', { name: 'Ingredient 1', exact: true }).fill('lentils');
	await page.getByRole('button', { name: 'Save recipe' }).click();
	await expect(page.getByRole('button', { name: 'Open Update-safe lentil soup' })).toBeVisible();

	const peer = await context.newPage();
	peer.on('pageerror', (error) => pageErrors.push(error.message));
	await peer.goto('/plan');
	await expect
		.poll(() => peer.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);
	await expect
		.poll(
			() =>
				new Set(
					protocol
						.filter(({ type }) => type === 'HEARTBEAT')
						.map(({ tabId }) => tabId)
						.filter(Boolean)
				).size
		)
		.toBe(2);

	const proofVersion = `proof-${Date.now()}`;
	await page.evaluate(async (version) => {
		await navigator.serviceWorker.register(`/service-worker.js?${version}`, { scope: '/' });
	}, proofVersion);
	await expect(page.getByText('Maal update ready')).toBeVisible();

	await page.getByRole('button', { name: 'Reload and update' }).click();
	await expect.poll(() => protocol.some(({ type }) => type === 'RELOAD')).toBe(true);
	const phases = protocol.map(({ type }) => type);
	expect(phases.indexOf('PREPARE_UPDATE')).toBeLessThan(phases.indexOf('UPDATE_PREPARING'));
	expect(phases.indexOf('UPDATE_PREPARING')).toBeLessThan(phases.indexOf('UPDATE_READY'));
	expect(phases.indexOf('UPDATE_READY')).toBeLessThan(phases.indexOf('RELOAD'));
	await expect.poll(() => controllerScript(page)).toContain(proofVersion);
	await expect.poll(() => controllerScript(peer)).toContain(proofVersion);

	await page.waitForLoadState('domcontentloaded');
	await expect(page.getByRole('button', { name: 'Open Update-safe lentil soup' })).toBeVisible();
	expect(pageErrors).toEqual([]);
});
