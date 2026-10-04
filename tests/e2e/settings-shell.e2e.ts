import { expect, test, type Page } from '@playwright/test';

const householdId = 'org_canal_kitchen';
const timestamp = '2026-08-21T12:00:00.000Z';

const resetDatabase = async () => {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase('maal-v1:production');
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
};

const seedSettings = async (paid: boolean) => {
	const databaseName = 'maal-v1:production';
	const profileId = '01990c69-7f00-7000-8000-000000000074';
	const householdId = 'org_canal_kitchen';
	const timestamp = '2026-08-21T12:00:00.000Z';
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	const stores = [
		'profiles',
		'authSlots',
		'households',
		'memberships',
		'billingCapabilities',
		'uiState'
	];
	const transaction = database.transaction(stores, 'readwrite');
	transaction.objectStore('profiles').put({
		profileId,
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
	transaction.objectStore('authSlots').put({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		profileId,
		workosUserId: 'user_alice',
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
		householdId,
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
	transaction.objectStore('memberships').put({
		membershipId: 'membership_alice',
		householdId,
		workosUserId: 'user_alice',
		roleSlug: 'admin',
		permissions: ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: timestamp,
		lastVerifiedAt: timestamp,
		updatedAt: timestamp,
		detachedAt: null,
		denialCode: null,
		source: 'workos'
	});
	if (paid) {
		transaction.objectStore('billingCapabilities').put({
			householdId,
			state: 'enabled',
			stripeStatus: 'active',
			subscriberUserId: 'user_alice',
			stripePriceId: 'price_monthly',
			currentPeriodEnd: '2026-09-21T12:00:00.000Z',
			interruptionStartedAt: null,
			graceUntil: null,
			validUntil: '2026-09-21T12:00:00.000Z',
			cancelAtPeriodEnd: false,
			stale: false,
			source: 'stripe-d1'
		});
	}
	transaction.objectStore('uiState').put({ key: 'activeProfileId', value: profileId });
	transaction.objectStore('uiState').put({
		key: `activeHouseholdId:${profileId}`,
		value: householdId
	});
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

const seed = async (page: Page, paid = false) => {
	await page.goto('/');
	await page.evaluate(resetDatabase);
	await page.goto('/plan');
	await expect
		.poll(() =>
			page.evaluate(async () =>
				(await indexedDB.databases()).some(
					(candidate) => candidate.name === 'maal-v1:production' && candidate.version === 50
				)
			)
		)
		.toBe(true);
	await page.evaluate(seedSettings, paid);
	await page.reload();
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(1);
};

const keyRecord = {
	id: 'key_settings',
	label: 'Kitchen agent',
	preset: 'read_only_planner',
	grantMode: 'selected',
	scopes: ['households:read', 'recipes:read', 'meals:read'],
	selectedHouseholdIds: [householdId],
	createdAt: timestamp,
	expiresAt: null,
	revokedAt: null,
	lastUsedAt: null,
	householdScope: { kind: 'households', householdIds: [householdId] }
};

test('opens local account and MCP settings in the shared shell without charging free content use', async ({
	page
}) => {
	const apiRequests: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
	});
	await seed(page);

	await page.getByRole('button', { name: /Alice de Vries alice@example\.test/ }).click();
	await page.getByRole('menuitem', { name: 'Settings' }).click();
	await expect(page).toHaveURL(/\/plan\?settings=account$/);
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	await expect(
		page.getByRole('dialog').getByText('Profiles on this device', { exact: true })
	).toBeVisible();
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(1);

	await page.getByRole('button', { name: 'MCP keys' }).click();
	await expect(page.getByText(/MCP needs an active Maal plan/)).toBeVisible();
	expect(apiRequests).toEqual([]);
});

test('manages a paid MCP key while keeping its raw secret out of IndexedDB', async ({ page }) => {
	const methods: string[] = [];
	await page.route('**/api/auth-slots/*/mcp-keys', async (route) => {
		const method = route.request().method();
		methods.push(method);
		if (method === 'GET') {
			await route.fulfill({ json: { keys: [] } });
			return;
		}
		if (method === 'POST') {
			await route.fulfill({ status: 201, json: { key: 'mk_secret_once', record: keyRecord } });
			return;
		}
		await route.abort();
	});
	await seed(page, true);
	await page.goto('/settings/mcp');
	await expect(page).toHaveURL(/\/plan\?settings=mcp$/);
	await expect(page.getByText('MCP server address')).toBeVisible();
	await page.getByRole('button', { name: 'Create MCP key' }).click();
	await page.getByLabel('Label').fill('Kitchen agent');
	await page.getByRole('button', { name: 'Create MCP key' }).last().click();
	await expect(page.getByText('mk_secret_once')).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('maal-v1:production');
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const records = await new Promise<unknown[]>((resolve, reject) => {
					const request = database
						.transaction('mcpKeySummaries')
						.objectStore('mcpKeySummaries')
						.getAll();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				database.close();
				return JSON.stringify(records);
			})
		)
		.not.toContain('mk_secret_once');
	await page.getByRole('button', { name: 'Close' }).click();
	await page.goto('/settings/mcp');
	await expect(page.getByText('mk_secret_once')).toHaveCount(0);
	expect(methods).toEqual(['GET', 'POST']);
});

test('keeps the approved settings and subscribe composition at desktop and phone widths', async ({
	page
}) => {
	await page.route('**/api/auth-slots/*/billing/status?*', async (route) => {
		await route.fulfill({
			json: {
				schemaVersion: 1,
				capability: {
					householdId,
					state: 'disabled',
					stripeStatus: null,
					subscriberUserId: null,
					stripePriceId: null,
					currentPeriodEnd: null,
					interruptionStartedAt: null,
					graceUntil: null,
					validUntil: null,
					cancelAtPeriodEnd: false,
					stale: false,
					source: 'stripe-d1'
				},
				prices: [
					{
						id: 'price_weekly',
						lookupKey: 'maal_weekly_v1',
						amountMinor: 200,
						currency: 'eur',
						interval: 'week',
						intervalCount: 1
					},
					{
						id: 'price_monthly',
						lookupKey: 'maal_monthly_v1',
						amountMinor: 500,
						currency: 'eur',
						interval: 'month',
						intervalCount: 1
					},
					{
						id: 'price_yearly',
						lookupKey: 'maal_yearly_v1',
						amountMinor: 5000,
						currency: 'eur',
						interval: 'year',
						intervalCount: 1
					}
				],
				trialAvailable: true,
				trialUnavailableReason: null,
				refreshedAt: '2026-08-22T12:00:00.000Z'
			}
		});
	});
	await page.setViewportSize({ width: 1280, height: 820 });
	await seed(page);
	await page.goto('/settings/account');
	await expect(page.getByRole('dialog').getByRole('heading', { name: 'Settings' })).toBeVisible();
	await expect(page).toHaveScreenshot('settings-account-desktop.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.01
	});

	await page.goto('/subscribe');
	await expect(
		page.getByRole('heading', { name: 'Choose a plan for Canal kitchen' })
	).toBeVisible();
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(1);
	await expect(page).toHaveScreenshot('subscribe-desktop.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.01
	});

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/settings/security');
	await expect(page.getByText('Retained account session')).toBeVisible();
	await expect(page).toHaveScreenshot('settings-security-phone.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.01
	});
});
