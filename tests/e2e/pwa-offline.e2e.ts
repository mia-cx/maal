import { expect, test } from '@playwright/test';

test('reopens the local shell offline without content API requests', async ({ context, page }) => {
	const contentRequests: string[] = [];
	page.on('request', (request) => {
		if (
			/\/api\/(?:sync|recipes\/import|billing|auth|auth-slots)|\/mcp(?:\/|$)/.test(request.url())
		) {
			contentRequests.push(request.url());
		}
	});

	await page.goto('/plan');
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
});
