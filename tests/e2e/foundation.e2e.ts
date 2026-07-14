import { expect, test } from '@playwright/test';

test('serves the clean rewrite shell', async ({ page }) => {
	await page.goto('/');

	await expect(page).toHaveTitle('Maal');
	await expect(page.getByRole('heading', { level: 1, name: 'Maal' })).toBeVisible();
});
