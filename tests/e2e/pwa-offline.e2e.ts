import { expect, test } from '@playwright/test';

test('reopens the local shell offline without content API requests', async ({ context, page }) => {
	const contentRequests: string[] = [];
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('request', (request) => {
		if (
			/\/api\/(?:sync|recipes\/import|billing|auth|auth-slots)|\/mcp(?:\/|$)/.test(request.url())
		) {
			contentRequests.push(request.url());
		}
	});

	await page.goto('/plan');
	const manifest = await page.evaluate(async () => {
		const response = await fetch('/manifest.webmanifest');
		return response.json() as Promise<{
			icons: { src: string; sizes: string; purpose: string; type: string }[];
		}>;
	});
	expect(manifest.icons).toEqual([
		{ src: '/icon-192.png', sizes: '192x192', purpose: 'any', type: 'image/png' },
		{ src: '/icon-512.png', sizes: '512x512', purpose: 'any', type: 'image/png' },
		{ src: '/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable', type: 'image/png' }
	]);
	for (const icon of manifest.icons) {
		const response = await page.request.get(icon.src);
		expect(response.ok()).toBe(true);
		expect(response.headers()['content-type']).toContain('image/png');
	}
	await page.evaluate(async () => navigator.serviceWorker.ready.then(() => undefined));
	await expect(page.getByText('Maal update ready')).toHaveCount(0);
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);

	await context.setOffline(true);
	await page.reload({ waitUntil: 'domcontentloaded' });

	await expect(page).toHaveTitle('Meal plan · Maal');
	await expect(page.getByText(/Choose a local profile|Opening local Maal data/)).toBeVisible();
	expect(contentRequests).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test('starts the PWA coordinator silently on the recovery route', async ({ page }) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));

	await page.goto('/recovery');
	await page.evaluate(async () => navigator.serviceWorker.ready.then(() => undefined));

	await expect(page.getByText('Local data recovery', { exact: true })).toBeVisible();
	await expect(page.getByText('Maal update ready')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});
