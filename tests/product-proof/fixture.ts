import { expect, type Page } from '@playwright/test';

export const databaseName = 'maal-v1:production';
export const profileId = '01990c69-7f00-7000-8000-000000000080';
export const secondProfileId = '01990c69-7f00-7000-8000-000000000081';
export const recipeId = '01990c69-7f00-7000-8000-000000000082';
export const householdId = 'org_canal_kitchen';
export const proofTimestamp = '2026-08-22T08:00:00.000Z';

const resetDatabase = async (name: string) => {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
};

const seedProductDatabase = async ({
	name,
	profileId,
	secondProfileId,
	recipeId,
	householdId,
	timestamp,
	recipeCount
}: {
	name: string;
	profileId: string;
	secondProfileId: string;
	recipeId: string;
	householdId: string;
	timestamp: string;
	recipeCount: number;
}) => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(name);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	const stores = [
		'profiles',
		'authSlots',
		'households',
		'memberships',
		'recipes',
		'billingCapabilities',
		'remoteProjectionMeta',
		'uiState'
	];
	const transaction = database.transaction(stores, 'readwrite');
	const profiles = transaction.objectStore('profiles');
	profiles.put({
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
	profiles.put({
		profileId: secondProfileId,
		workosUserId: 'user_bob',
		displayName: 'Bob de Vries',
		email: 'bob@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: '2026-08-22T07:00:00.000Z',
		authState: 'authenticated'
	});
	const slots = transaction.objectStore('authSlots');
	slots.put({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		profileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: timestamp,
		lastVerifiedAt: timestamp,
		nextRetryAt: null,
		retryCount: 0
	});
	slots.put({
		authSlotId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		profileId: secondProfileId,
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
	const memberships = transaction.objectStore('memberships');
	const permissions = [
		'households:write',
		'recipes:read',
		'recipes:write',
		'meals:read',
		'meals:write'
	];
	for (const [membershipId, workosUserId, roleSlug] of [
		['membership_alice', 'user_alice', 'admin'],
		['membership_bob', 'user_bob', 'admin']
	]) {
		memberships.put({
			membershipId,
			householdId,
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
	const recipes = transaction.objectStore('recipes');
	for (let index = 0; index < recipeCount; index += 1) {
		const id =
			index === 0
				? recipeId
				: `01990c69-8000-7000-8000-${(index + 100).toString(16).padStart(12, '0')}`;
		const sequence = String(index + 1).padStart(5, '0');
		const title = index === 0 ? 'Gingery chicken rice bowls' : `Kitchen recipe ${sequence}`;
		recipes.put({
			schemaVersion: 1,
			revision: 1,
			createdAt: timestamp,
			updatedAt: `2026-08-22T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
			deletedAt: null,
			conflictClocks: {},
			id,
			ownerUserId: 'user_alice',
			savedFromHouseholdId: householdId,
			title,
			description:
				index === 0
					? 'Crunchy cucumbers, sesame sauce, and enough leftovers for lunch.'
					: `A deterministic local recipe fixture ${sequence}.`,
			imageUrl: null,
			prepTimeMinutes: 15,
			cookTimeMinutes: 25,
			totalTimeMinutes: 40,
			yield: 4,
			sourceYieldText: 'Serves 4',
			sourceClaimedMinutes: 40,
			sourceDatePublished: null,
			sourceDateModified: null,
			sourceLanguage: 'en',
			sourceUrl: null,
			sourceSiteName: null,
			sourceAuthorName: null,
			sourcePublisherName: null,
			sourceIsBasedOnUrl: null,
			sourceImportedAt: timestamp,
			sourceHtmlHash: null,
			sourceRatingValue: null,
			sourceRatingCount: null,
			sourceReviewCount: null,
			parseConfidence: 1,
			ingredientConfidence: 1,
			instructionConfidence: 1,
			nutritionConfidence: null,
			userNotes: null,
			ingredients: [],
			instructions: [],
			instructionEvents: [],
			applianceRequirements: [],
			classifications: [],
			media: [],
			nutritionFacts: [],
			searchTokens:
				index === 0 ? ['gingery', 'chicken', 'rice', 'bowls'] : ['kitchen', 'recipe', sequence]
		});
	}
	transaction.objectStore('billingCapabilities').put({
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
	});
	transaction.objectStore('remoteProjectionMeta').put({
		key: `billing:${householdId}`,
		refreshedAt: timestamp,
		decodeVersion: 1,
		value: {
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
			trialUnavailableReason: null
		}
	});
	const uiState = transaction.objectStore('uiState');
	uiState.put({ key: 'activeProfileId', value: profileId });
	uiState.put({ key: `activeHouseholdId:${profileId}`, value: householdId });
	uiState.put({ key: `activeHouseholdId:${secondProfileId}`, value: householdId });
	uiState.put({
		key: `schedule:${profileId}:${householdId}`,
		value: { scheduleMode: 'multi-day', scheduleAnchorDate: '2026-08-23', dailyScroll: null }
	});
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

const billingProjection = {
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
	refreshedAt: proofTimestamp
};

export const stubProductApis = async (page: Page): Promise<void> => {
	await page.route('**/api/auth-slots/*/billing/status?*', async (route) => {
		await route.fulfill({ json: billingProjection });
	});
};

export const seedProduct = async (
	page: Page,
	{ recipeCount = 1 }: { recipeCount?: number } = {}
): Promise<void> => {
	await stubProductApis(page);
	await page.goto('/');
	await page.evaluate(resetDatabase, databaseName);
	await page.goto('/plan');
	await expect
		.poll(() =>
			page.evaluate(async (name) => {
				const candidate = (await indexedDB.databases()).find((entry) => entry.name === name);
				return candidate?.version ?? 0;
			}, databaseName)
		)
		.toBe(50);
	await page.evaluate(seedProductDatabase, {
		name: databaseName,
		profileId,
		secondProfileId,
		recipeId,
		householdId,
		timestamp: proofTimestamp,
		recipeCount
	});
	await page.reload();
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(1);
};

export const openSettings = async (page: Page, category: string): Promise<void> => {
	await page.goto(`/plan?settings=${category}`);
	await expect(page.getByRole('dialog').getByRole('heading', { name: 'Settings' })).toBeVisible();
};
