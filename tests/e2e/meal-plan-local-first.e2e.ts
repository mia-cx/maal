import { expect, test, type Page } from '@playwright/test';

const resetDatabase = async () => {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase('maal-v1:production');
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
};

const seedPlan = async () => {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('maal-v1:production');
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
	const stores = ['profiles', 'authSlots', 'households', 'memberships', 'recipes', 'uiState'];
	const transaction = database.transaction(stores, 'readwrite');
	transaction.objectStore('profiles').put({
		profileId: '01990c69-7f00-7000-8000-000000000031',
		workosUserId: 'user_alice',
		displayName: 'Alice de Vries',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: '2026-08-21T12:00:00.000Z',
		authState: 'authenticated'
	});
	transaction.objectStore('authSlots').put({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		profileId: '01990c69-7f00-7000-8000-000000000031',
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: '2026-08-21T12:00:00.000Z',
		lastVerifiedAt: '2026-08-21T12:00:00.000Z',
		nextRetryAt: null,
		retryCount: 0
	});
	transaction.objectStore('households').put({
		schemaVersion: 1,
		revision: 1,
		createdAt: '2026-08-21T12:00:00.000Z',
		updatedAt: '2026-08-21T12:00:00.000Z',
		deletedAt: null,
		conflictClocks: {},
		householdId: 'org_canal_kitchen',
		name: 'Canal kitchen',
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		weekStartsOn: 0,
		defaultPlannedYield: 4,
		preferredDinnerTime: '18:30',
		createdByUserId: 'user_alice',
		deletionState: 'active',
		localOnly: false
	});
	transaction.objectStore('memberships').put({
		membershipId: 'membership_alice',
		householdId: 'org_canal_kitchen',
		workosUserId: 'user_alice',
		roleSlug: 'admin',
		permissions: ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: '2026-08-21T12:00:00.000Z',
		lastVerifiedAt: '2026-08-21T12:00:00.000Z',
		updatedAt: '2026-08-21T12:00:00.000Z',
		detachedAt: null,
		denialCode: null,
		source: 'workos'
	});
	transaction.objectStore('recipes').put({
		schemaVersion: 1,
		revision: 1,
		createdAt: '2026-08-21T12:00:00.000Z',
		updatedAt: '2026-08-21T12:00:00.000Z',
		deletedAt: null,
		conflictClocks: {},
		id: '01990c69-7f00-7000-8000-000000000032',
		ownerUserId: 'user_alice',
		savedFromHouseholdId: 'org_canal_kitchen',
		title: 'Gingery chicken rice bowls',
		description: 'Crunchy cucumbers, sesame sauce, and enough leftovers for lunch.',
		imageUrl:
			'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80',
		prepTimeMinutes: 15,
		cookTimeMinutes: 25,
		totalTimeMinutes: 40,
		yield: 4,
		sourceYieldText: 'Serves 4',
		sourceClaimedMinutes: 40,
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: 'en',
		sourceUrl: 'https://example.test/rice-bowls',
		sourceSiteName: 'Canal Kitchen Notes',
		sourceAuthorName: 'Alice de Vries',
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		sourceImportedAt: '2026-08-21T12:00:00.000Z',
		sourceHtmlHash: null,
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		parseConfidence: 1,
		ingredientConfidence: 1,
		instructionConfidence: 1,
		nutritionConfidence: null,
		userNotes: null,
		ingredients: [
			{
				id: '01990c69-7f00-7000-8000-000000000033',
				lineIndex: 0,
				originalText: '400 g boneless chicken thighs',
				sourceAmountText: '400',
				sourceQuantity: 400,
				sourceUnitLabel: 'g',
				sourceFoodLabel: 'boneless chicken thighs',
				baseFoodId: null,
				baseQuantity: null,
				baseUnitId: null,
				baseUnitFamilyId: null,
				optional: false,
				confidence: 1,
				createdAt: '2026-08-21T12:00:00.000Z'
			}
		],
		instructions: [
			{
				id: '01990c69-7f00-7000-8000-000000000034',
				stepIndex: 0,
				sectionName: null,
				text: 'Sear the chicken and build the bowls.',
				durationMinutes: 25,
				confidence: 1,
				createdAt: '2026-08-21T12:00:00.000Z',
				updatedAt: '2026-08-21T12:00:00.000Z'
			}
		],
		instructionEvents: [],
		applianceRequirements: [],
		classifications: [],
		media: [],
		nutritionFacts: [],
		searchTokens: ['gingery', 'chicken', 'rice', 'bowls']
	});
	transaction.objectStore('uiState').put({
		key: 'activeProfileId',
		value: '01990c69-7f00-7000-8000-000000000031'
	});
	transaction.objectStore('uiState').put({
		key: 'activeHouseholdId:01990c69-7f00-7000-8000-000000000031',
		value: 'org_canal_kitchen'
	});
	transaction.objectStore('uiState').put({
		key: 'schedule:01990c69-7f00-7000-8000-000000000031:org_canal_kitchen',
		value: {
			scheduleMode: 'multi-day',
			scheduleAnchorDate: '2026-08-23',
			dailyScroll: null
		}
	});
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	database.close();
};

const seed = async (page: Page) => {
	await page.goto('/');
	await page.evaluate(resetDatabase);
	await page.goto('/plan');
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const databases = await indexedDB.databases();
				return databases.some(
					({ name, version }) => name === 'maal-v1:production' && version === 30
				);
			})
		)
		.toBe(true);
	await page.evaluate(seedPlan);
	await page.reload();
	await expect(page.getByText('Gingery chicken rice bowls').first()).toBeVisible();
};

test('plans while offline and reloads from Dexie without content API requests', async ({
	context,
	page
}) => {
	const apiRequests: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
	});
	await page.setViewportSize({ width: 1280, height: 820 });
	await seed(page);

	await context.setOffline(true);
	const recipeCard = page.getByRole('button', { name: 'Open Gingery chicken rice bowls' }).first();
	const targetDay = page.locator('[data-meal-drop-date="2026-08-23"]').first();
	const [recipeBox, targetBox] = await Promise.all([
		recipeCard.boundingBox(),
		targetDay.boundingBox()
	]);
	if (!recipeBox || !targetBox) throw new Error('The recipe card and target day must be visible.');
	await page.mouse.move(recipeBox.x + recipeBox.width / 2, recipeBox.y + recipeBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		recipeBox.x + recipeBox.width / 2 + 12,
		recipeBox.y + recipeBox.height / 2,
		{
			steps: 2
		}
	);
	await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 120, { steps: 8 });
	await page.mouse.up();
	await expect(targetDay).toContainText('Gingery chicken rice bowls');
	await expect(recipeCard).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('maal-v1:production');
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const count = await new Promise<number>((resolve, reject) => {
					const request = database.transaction('meals').objectStore('meals').count();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				database.close();
				return count;
			})
		)
		.toBe(1);
	await context.setOffline(false);
	await page.reload();
	await expect(page.locator('[data-meal-drop-date="2026-08-23"]').first()).toContainText(
		'Gingery chicken rice bowls'
	);
	expect(apiRequests).toEqual([]);
});

test('preserves the schedule composition at desktop and phone widths', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 820 });
	await seed(page);
	await expect(page).toHaveScreenshot('meal-plan-multi-day-desktop.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.01
	});

	await page.getByRole('button', { name: 'Month' }).click();
	await expect(page).toHaveScreenshot('meal-plan-month-desktop.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.01
	});

	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Day', exact: true }).click();
	await expect(page).toHaveScreenshot('meal-plan-day-phone.png', {
		animations: 'disabled',
		maxDiffPixelRatio: 0.01
	});
});
