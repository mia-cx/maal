import { expect, test } from '@playwright/test';

test('enters the local-first meal plan through the shared shell', async ({ page }) => {
	await page.goto('/plan');

	await expect(page).toHaveURL(/\/plan$/);
	await expect(page).toHaveTitle('Meal plan · Maal');
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(1);
	await expect(page.getByTestId('app-sidebar')).toHaveCount(1);
	const sidebar = page.getByTestId('app-sidebar');
	await expect(sidebar.getByText('Pantry', { exact: true }).locator('..')).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	await expect(sidebar.getByText('Grocery rollup', { exact: true }).locator('..')).toHaveAttribute(
		'aria-disabled',
		'true'
	);
});

test('shows the public prototype landing page and links to the legal policies', async ({
	page
}) => {
	await page.goto('/');
	await expect(page).toHaveTitle('Maal · Flexible meal planning');
	await expect(page.getByRole('heading', { name: /Meal planning built for/ })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Start planning' }).first()).toHaveAttribute(
		'href',
		'/auth/login'
	);
	await page.getByRole('link', { name: 'Privacy Policy' }).click();
	await expect(page).toHaveURL(/\/legal\/privacy$/);
	await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
});

test('keeps previews unavailable and opens signed-out onboarding', async ({ page }) => {
	for (const path of ['/pantry', '/groceries']) {
		await page.goto(path);
		await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
		await expect(page.getByText('Feature not available.')).toBeVisible();
	}
	await page.goto('/onboarding');
	await expect(page).toHaveTitle('Set up household · Maal');
	await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
		'href',
		'/auth/login?returnTo=/onboarding'
	);
});
