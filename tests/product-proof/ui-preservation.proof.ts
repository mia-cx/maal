import { expect, test, type Page } from '@playwright/test';

import { openSettings, seedProduct } from './fixture.js';

const viewports = [
	{ name: 'phone', width: 390, height: 844, scheduleMode: 'Day' },
	{ name: 'tablet', width: 1024, height: 768, scheduleMode: 'Multi-day' },
	{ name: 'desktop', width: 1440, height: 900, scheduleMode: 'Month' }
] as const;

const capture = async (page: Page, name: string) => {
	await page.mouse.move(1, 1);
	await expect(page).toHaveScreenshot(`${name}.png`, {
		animations: 'disabled',
		caret: 'hide',
		maxDiffPixelRatio: 0.001
	});
};

const planRecipeOn = async (page: Page, date: string) => {
	const recipe = page.getByRole('button', { name: 'Open Gingery chicken rice bowls' }).first();
	const day = page.locator(`[data-meal-drop-date="${date}"]`).first();
	const [recipeBox, dayBox] = await Promise.all([recipe.boundingBox(), day.boundingBox()]);
	if (!recipeBox || !dayBox) throw new Error('The recipe and target day must be visible.');
	await page.mouse.move(recipeBox.x + recipeBox.width / 2, recipeBox.y + recipeBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		recipeBox.x + recipeBox.width / 2 + 12,
		recipeBox.y + recipeBox.height / 2,
		{
			steps: 2
		}
	);
	await page.mouse.move(dayBox.x + dayBox.width / 2, dayBox.y + Math.min(dayBox.height / 2, 120), {
		steps: 8
	});
	await page.mouse.up();
	await expect(day).toContainText('Gingery chicken rice bowls');
};

for (const viewport of viewports) {
	test(`${viewport.name} preserves every in-scope product surface`, async ({ page }) => {
		test.setTimeout(90_000);
		await page.clock.setFixedTime(new Date('2026-08-22T12:00:00.000Z'));
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await seedProduct(page);

		await page.getByRole('button', { name: viewport.scheduleMode, exact: true }).click();
		if (viewport.scheduleMode === 'Month') {
			await expect(page.getByRole('region', { name: 'Monthly schedule' })).toBeVisible();
		} else if (viewport.scheduleMode === 'Multi-day') {
			await expect(page.getByRole('region', { name: 'Multi-day schedule' })).toBeVisible();
		} else {
			await expect(page.locator('[data-meal-drop-date]').first()).toBeVisible();
		}
		await capture(page, `${viewport.name}-plan-${viewport.scheduleMode.toLowerCase()}`);
		await planRecipeOn(page, '2026-08-23');
		await page.clock.setFixedTime(new Date('2026-08-24T12:00:00.000Z'));
		await page.reload();
		await page.getByRole('button', { name: 'Check in' }).first().click();
		await expect(page.getByRole('dialog', { name: 'Meal check-in' })).toBeVisible();
		await capture(page, `${viewport.name}-focused-check-in`);
		await page.getByRole('button', { name: 'Never again' }).click();
		await page.getByLabel('Notes').fill('Too much washing up.');
		await page.getByRole('button', { name: 'Save check-in' }).click();
		await expect(page.getByRole('button', { name: 'Edit check-in' }).first()).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const request = indexedDB.open('maal-v1:production');
					const database = await new Promise<IDBDatabase>((resolve, reject) => {
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					const countRequest = database
						.transaction('mealCheckIns')
						.objectStore('mealCheckIns')
						.count();
					const count = await new Promise<number>((resolve, reject) => {
						countRequest.onsuccess = () => resolve(countRequest.result);
						countRequest.onerror = () => reject(countRequest.error);
					});
					database.close();
					return count;
				})
			)
			.toBe(1);
		await page.keyboard.press('d');
		await expect(page.locator('[data-daily-scroller]')).toBeVisible();
		await page.keyboard.press('w');
		await expect(page.getByRole('region', { name: 'Multi-day schedule' })).toBeVisible();
		await page.keyboard.press('m');
		await expect(page.getByRole('region', { name: 'Monthly schedule' })).toBeVisible();
		await page.clock.setFixedTime(new Date('2026-08-22T12:00:00.000Z'));

		await page.goto('/menu');
		await expect(
			page.getByRole('button', { name: 'Open Gingery chicken rice bowls' })
		).toBeVisible();
		await capture(page, `${viewport.name}-recipes`);

		await page.goto('/household');
		await expect(page.getByRole('heading', { name: 'Household settings' })).toBeVisible();
		await capture(page, `${viewport.name}-household`);
		const preferencesHeading = page.getByRole('heading', { name: 'Aliases & overrides' });
		await preferencesHeading.scrollIntoViewIfNeeded();
		await expect(preferencesHeading).toBeVisible();
		await capture(page, `${viewport.name}-preferences`);

		await openSettings(page, 'account');
		await expect(page.getByText('Profiles on this device', { exact: true })).toBeVisible();
		await capture(page, `${viewport.name}-settings-account`);

		await openSettings(page, 'security');
		await expect(page.getByText('Retained account session', { exact: true })).toBeVisible();
		await capture(page, `${viewport.name}-settings-security`);

		await openSettings(page, 'mcp');
		await expect(page.getByText(/MCP needs an active Maal plan/)).toBeVisible();
		await capture(page, `${viewport.name}-settings-mcp`);

		await openSettings(page, 'billing');
		await expect(page.getByRole('region', { name: 'Billing' })).toBeVisible();
		await capture(page, `${viewport.name}-settings-billing`);

		await page.goto('/subscribe');
		await expect(page.getByRole('heading', { name: 'Maal plan' })).toBeVisible();
		await capture(page, `${viewport.name}-subscribe`);

		await page.goto('/recovery');
		await expect(page.getByText('Local data recovery', { exact: true })).toBeVisible();
		await capture(page, `${viewport.name}-recovery`);
	});
}
