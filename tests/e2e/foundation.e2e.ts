import { expect, test } from '@playwright/test';

test('enters the local-first meal plan through the shared shell', async ({ page }) => {
	await page.goto('/');

	await expect(page).toHaveURL(/\/plan$/);
	await expect(page).toHaveTitle('Meal plan · Maal');
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(1);
	await expect(page.getByTestId('app-sidebar')).toHaveCount(1);
});
