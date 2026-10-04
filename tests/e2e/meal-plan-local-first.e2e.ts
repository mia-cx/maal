import { expect, test, type Locator, type Page } from '@playwright/test';

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
				text: 'Roast the chicken at 200°C and build the bowls.',
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
					({ name, version }) => name === 'maal-v1:production' && version === 50
				);
			})
		)
		.toBe(true);
	await page.evaluate(seedPlan);
	await page.reload();
	await addRecipeToPool(page);
};

const mealPool = (page: Page) => page.locator('[data-meal-drop-kind="pool"]').first();

/** Adds the seeded recipe through the pool's Add meal picker, then closes the meal preview. */
const addRecipeToPool = async (page: Page) => {
	await mealPool(page).getByRole('button', { name: 'Add meal' }).click();
	await page.getByRole('option', { name: /Gingery chicken rice bowls/ }).click();
	await closeMealPreview(page);
	await expect(mealPool(page)).toContainText('Gingery chicken rice bowls');
};

const closeMealPreview = async (page: Page) => {
	const close = page.getByRole('button', { name: 'Close meal preview' }).first();
	await expect(close).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
};

type Row = Record<string, unknown>;
const readStore = (page: Page, store: string) =>
	page.evaluate(async (name) => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('maal-v1:production');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const rows = await new Promise<Row[]>((resolve, reject) => {
			const request = database.transaction(name).objectStore(name).getAll();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result as Row[]);
		});
		database.close();
		return rows;
	}, store);

const dragTo = async (page: Page, source: Locator, target: Locator, targetY?: number) => {
	const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
	if (!sourceBox || !targetBox) throw new Error('The dragged card and its target must be visible.');
	await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2 + 12,
		sourceBox.y + sourceBox.height / 2,
		{
			steps: 2
		}
	);
	await page.mouse.move(
		targetBox.x + targetBox.width / 2,
		targetY ?? targetBox.y + Math.min(120, targetBox.height / 2),
		{ steps: 8 }
	);
	await page.mouse.up();
};

const planRecipeOn = async (page: Page, date: string) => {
	const recipeCard = mealPool(page)
		.getByRole('button', { name: 'Open Gingery chicken rice bowls' })
		.first();
	const targetDay = page.locator(`[data-meal-drop-date="${date}"]`).first();
	await dragTo(page, recipeCard, targetDay);
	await expect(targetDay).toContainText('Gingery chicken rice bowls');
	return { targetDay };
};

test('renders the first-visit plan with an error when the saved schedule state cannot be read', async ({
	page
}) => {
	// Every uiState read except the schedule row still works, so the plan itself loads.
	await page.addInitScript(() => {
		const original = IDBObjectStore.prototype.get;
		IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
			if (this.name === 'uiState' && typeof key === 'string' && key.startsWith('schedule:'))
				throw new DOMException('Injected schedule-state read failure.');
			return original.call(this, key);
		};
	});
	await page.goto('/');
	await page.evaluate(resetDatabase);
	await page.goto('/plan');
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const databases = await indexedDB.databases();
				return databases.some(
					({ name, version }) => name === 'maal-v1:production' && version === 50
				);
			})
		)
		.toBe(true);
	await page.evaluate(seedPlan);
	await page.reload();
	await expect(mealPool(page).getByRole('button', { name: 'Add meal' })).toBeVisible();
	await expect(page.getByText('Your local meal plan could not be read.')).toBeVisible();
});

test('plans while offline and reloads from Dexie without content API requests', async ({
	context,
	page
}, testInfo) => {
	const sameOriginRequests: Array<{ method: string; path: string; resourceType: string }> = [];
	const d1CapableRequests: string[] = [];
	const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.origin !== appOrigin) return;
		sameOriginRequests.push({
			method: request.method(),
			path: url.pathname,
			resourceType: request.resourceType()
		});
		if (/^\/(?:api|mcp)(?:\/|$)/.test(url.pathname)) d1CapableRequests.push(request.url());
	});
	await page.setViewportSize({ width: 1280, height: 820 });
	await seed(page);

	await context.setOffline(true);
	await planRecipeOn(page, '2026-08-23');
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
	await testInfo.attach('free-meal-network-trace', {
		body: Buffer.from(JSON.stringify({ sameOriginRequests, d1CapableRequests }, null, 2)),
		contentType: 'application/json'
	});
	expect(d1CapableRequests).toEqual([]);
});

test('reacts to indexed range writes and preserves keyboard modes and focused check-ins', async ({
	context,
	page
}) => {
	await page.clock.setFixedTime(new Date('2026-08-24T12:00:00.000Z'));
	await page.setViewportSize({ width: 1280, height: 820 });
	await seed(page);
	const { targetDay } = await planRecipeOn(page, '2026-08-23');

	// Another tab reschedules the meal through Dexie; this tab's range query must follow it.
	const otherTab = await context.newPage();
	await otherTab.setViewportSize({ width: 1280, height: 820 });
	await otherTab.goto('/plan');
	const otherDay = (date: string) => otherTab.locator(`[data-meal-drop-date="${date}"]`).first();
	const movedDay = page.locator('[data-meal-drop-date="2026-08-25"]').first();
	const otherCard = (date: string) =>
		otherDay(date).getByRole('button', { name: 'Open Gingery chicken rice bowls' });
	await dragTo(otherTab, otherCard('2026-08-23'), otherDay('2026-08-25'));
	await expect(targetDay).not.toContainText('Gingery chicken rice bowls');
	await expect(movedDay).toContainText('Gingery chicken rice bowls');
	await dragTo(otherTab, otherCard('2026-08-25'), otherDay('2026-08-23'));
	await expect(targetDay).toContainText('Gingery chicken rice bowls');
	await otherTab.close();

	await page.keyboard.press('m');
	await expect(page.getByRole('region', { name: 'Monthly schedule' })).toBeVisible();
	await page.getByRole('button', { name: 'Check in' }).first().click();
	await expect(page.getByRole('dialog', { name: 'Meal check-in' })).toBeVisible();
	await page.getByRole('button', { name: 'Never again' }).click();
	await page.getByLabel('Notes').fill('Too much washing up.');
	await page.getByRole('button', { name: 'Save check-in' }).click();
	await expect(page.getByRole('button', { name: 'Edit check-in' }).first()).toBeVisible();

	await page.keyboard.press('d');
	await expect(page.locator('[data-daily-scroller]')).toBeVisible();
	await page.keyboard.press('w');
	await expect(page.getByRole('region', { name: 'Multi-day schedule' })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('maal-v1:production');
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				const count = await new Promise<number>((resolve, reject) => {
					const request = database.transaction('mealCheckIns').objectStore('mealCheckIns').count();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
				});
				database.close();
				return count;
			})
		)
		.toBe(1);
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

test.describe('meal pool', () => {
	test.beforeEach(async ({ page }) => {
		await page.clock.setFixedTime(new Date('2026-08-24T12:00:00.000Z'));
		await page.setViewportSize({ width: 1280, height: 820 });
	});

	test('keeps a meal dragged back to the pool across reloads', async ({ page }) => {
		await seed(page);
		const { targetDay } = await planRecipeOn(page, '2026-08-23');
		const [meal] = await readStore(page, 'meals');
		await dragTo(page, targetDay.locator(`[data-meal-card-id="${meal!.id}"]`), mealPool(page));
		await expect.poll(async () => (await readStore(page, 'meals'))[0]!.date).toBeNull();
		await expect(mealPool(page).locator(`[data-meal-card-id="${meal!.id}"]`)).toBeVisible();

		await page.reload();
		await expect(mealPool(page).locator(`[data-meal-card-id="${meal!.id}"]`)).toBeVisible();
		await expect(targetDay).not.toContainText('Gingery chicken rice bowls');
	});

	test('keeps a pool meal visible and editable after saving a time without a date', async ({
		page
	}) => {
		await seed(page);
		const [meal] = await readStore(page, 'meals');
		const card = mealPool(page).locator(`[data-meal-card-id="${meal!.id}"]`);
		await card.click();
		await page.getByRole('button', { name: /Choose a date and time/ }).click();
		await page.getByRole('textbox', { name: 'Start eating', exact: true }).fill('18:30');
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Save meal', exact: true }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect
			.poll(async () =>
				(await readStore(page, 'meals')).map(({ id, date, time }) => ({ id, date, time }))
			)
			.toEqual([{ id: meal!.id, date: null, time: '18:30' }]);
		await expect(card).toBeVisible();

		await page.reload();
		await expect(card).toBeVisible();
		await card.click();
		await page.getByRole('button', { name: /Choose a date and time/ }).click();
		await expect(page.getByRole('textbox', { name: 'Start eating', exact: true })).toHaveValue(
			'18:30'
		);
	});

	test('previews a pool meal without writing anything', async ({ page }) => {
		await seed(page);
		const counts = async () => ({
			meals: (await readStore(page, 'meals')).length,
			outbox: (await readStore(page, 'outbox')).length
		});
		const before = await counts();
		expect(before.meals).toBe(1);
		const card = mealPool(page).getByRole('button', { name: 'Open Gingery chicken rice bowls' });
		for (let opened = 0; opened < 2; opened += 1) {
			await card.click();
			await closeMealPreview(page);
		}
		expect(await counts()).toEqual(before);
	});

	test('drops a pool meal at the pointer index below an unordered meal', async ({ page }) => {
		await seed(page);
		const targetDay = page.locator('[data-meal-drop-date="2026-08-23"]').first();
		// Add meal on a day stores the meal without a sortOrder.
		await page
			.getByRole('group', { name: 'Add meal on 2026-08-23' })
			.getByRole('button')
			.dblclick();
		await page.getByRole('option', { name: /Gingery chicken rice bowls/ }).click();
		await closeMealPreview(page);
		await expect(targetDay).toContainText('Gingery chicken rice bowls');
		const first = (await readStore(page, 'meals')).find(({ date }) => date === '2026-08-23');
		expect(first?.sortOrder).toBeNull();

		const firstCard = targetDay.locator(`[data-meal-card-id="${first!.id}"]`);
		const firstBox = await firstCard.boundingBox();
		if (!firstBox) throw new Error('The first planned meal must be visible.');
		await dragTo(
			page,
			mealPool(page).getByRole('button', { name: 'Open Gingery chicken rice bowls' }),
			targetDay,
			firstBox.y + firstBox.height + 24
		);
		const dayOrder = () =>
			targetDay
				.locator('[data-meal-card-id]')
				.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-meal-card-id')));
		await expect.poll(async () => (await dayOrder()).length).toBe(2);
		expect((await dayOrder())[0]).toBe(first!.id);
		await page.reload();
		await expect.poll(async () => (await dayOrder())[0]).toBe(first!.id);
	});

	test('settles daily scroll state without a Dexie write per frame', async ({ page }) => {
		await page.addInitScript(() => {
			const counts = { uiStatePuts: 0 };
			(window as unknown as { __maalCounts: typeof counts }).__maalCounts = counts;
			const put = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
				if (this.name === 'uiState') counts.uiStatePuts += 1;
				return put.apply(this, args);
			};
		});
		await seed(page);
		await page.keyboard.press('d');
		const scroller = page.locator('[data-daily-scroller]');
		await expect(scroller).toBeVisible();
		await page.waitForTimeout(500);
		const uiStatePuts = () =>
			page.evaluate(
				() =>
					(window as unknown as { __maalCounts: { uiStatePuts: number } }).__maalCounts.uiStatePuts
			);
		const before = await uiStatePuts();
		const box = await scroller.boundingBox();
		if (!box) throw new Error('The daily scroller must be visible.');
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		for (let step = 0; step < 20; step += 1) {
			await page.mouse.wheel(0, 120);
			await page.waitForTimeout(50);
		}
		await page.waitForTimeout(500);
		expect((await uiStatePuts()) - before).toBeLessThanOrEqual(12);
	});
});

const putRow = (page: Page, store: string, row: Row) =>
	page.evaluate(
		async ({ name, value }) => {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('maal-v1:production');
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result);
			});
			const transaction = database.transaction(name, 'readwrite');
			transaction.objectStore(name).put(value);
			await new Promise<void>((resolve, reject) => {
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
			database.close();
		},
		{ name: store, value: row }
	);

test.describe('meal sheet', () => {
	test.beforeEach(async ({ page }) => {
		await page.clock.setFixedTime(new Date('2026-08-24T12:00:00.000Z'));
		await page.setViewportSize({ width: 1280, height: 820 });
	});

	test('shows only the active profile’s own check-in', async ({ page }) => {
		await seed(page);
		await planRecipeOn(page, '2026-08-23');
		const [meal] = await readStore(page, 'meals');
		await putRow(page, 'mealCheckIns', {
			schemaVersion: 1,
			revision: 1,
			createdAt: '2026-08-23T20:00:00.000Z',
			updatedAt: '2026-08-23T20:00:00.000Z',
			deletedAt: null,
			conflictClocks: {},
			id: '01990c69-7f00-7000-8000-0000000000b0',
			reporterUserId: 'user_bob',
			mealId: meal!.id,
			cookTimeMinutes: null,
			verdict: 'avoid',
			reason: 'Bob says too spicy'
		});
		await page.reload();

		await expect(page.getByRole('button', { name: 'Check in' }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Edit check-in' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Check in' }).first().click();
		await expect(page.getByRole('dialog', { name: 'Meal check-in' })).toBeVisible();
		await expect(page.getByLabel('Notes')).toHaveValue('');
	});

	test('saves a custom meal’s name from the sheet', async ({ page }) => {
		await seed(page);
		const { targetDay } = await planRecipeOn(page, '2026-08-23');
		const [meal] = await readStore(page, 'meals');
		await putRow(page, 'meals', { ...meal, sourceRecipeId: null });
		await page.reload();

		await targetDay.getByRole('button', { name: 'Open Gingery chicken rice bowls' }).click();
		await page.getByLabel('Meal name').fill('Renamed bowls');
		await page.getByRole('button', { name: 'Save meal' }).click();
		await expect.poll(async () => (await readStore(page, 'meals'))[0]!.title).toBe('Renamed bowls');
		expect(
			(await readStore(page, 'outbox')).filter(
				({ aggregateId, conflictGroup }) => aggregateId === meal!.id && conflictGroup === 'header'
			)
		).toHaveLength(1);

		await page.reload();
		await expect(targetDay).toContainText('Renamed bowls');
	});

	test('restores the meal and says why when a sheet save fails', async ({ page }) => {
		await seed(page);
		const { targetDay } = await planRecipeOn(page, '2026-08-23');
		const [meal] = await readStore(page, 'meals');
		await targetDay.getByRole('button', { name: 'Open Gingery chicken rice bowls' }).click();
		// Another device deleted the meal while this sheet was open.
		await putRow(page, 'meals', { ...meal, deletedAt: '2026-08-24T11:00:00.000Z' });
		await page.getByRole('button', { name: 'Save meal' }).click();

		await expect(page.getByText('The meal is not available in this household.')).toBeVisible();
	});

	test('shows meal sheet temperatures in the household’s preferred unit', async ({ page }) => {
		await seed(page);
		await page.goto('/household');
		const temperature = page.locator('label', { hasText: 'Temperature unit' });
		await temperature.getByRole('button').click();
		await page.getByRole('option', { name: /°F/ }).first().click();
		await page.getByRole('button', { name: 'Save overrides' }).click();
		await expect(temperature).toContainText('°F');
		await expect
			.poll(async () =>
				(await readStore(page, 'householdUnitDisplayPreferences')).some(
					(row) => row.baseUnitId === 'celsius' && row.preferredUnitId === 'fahrenheit'
				)
			)
			.toBe(true);

		await page.goto('/plan');
		await mealPool(page).getByRole('button', { name: 'Open Gingery chicken rice bowls' }).click();
		await expect(page.getByText(/Roast the chicken at 39\d°F/)).toBeVisible();
		await expect(page.getByText('200°C')).toHaveCount(0);
	});
});
