import { expect, test } from '@playwright/test';

test('enters the local-first meal plan through the shared shell', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dinner plans that can change');
	await expect(page.getByTestId('shared-app-shell')).toHaveCount(0);
	await page.getByRole('link', { name: 'Pricing' }).click();
	await expect(
		page.getByRole('heading', { name: 'Free forever locally, pay for sync' })
	).toBeInViewport();
	await page.getByRole('main').getByRole('link', { name: 'Open the planner' }).click();

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

test('links all legal policies from the homepage footer', async ({ page }) => {
	await page.goto('/');
	const footer = page.getByRole('contentinfo');
	for (const [name, path] of [
		['Privacy Policy', '/legal/privacy'],
		['Terms of Use', '/legal/terms'],
		['Cookie Policy', '/legal/cookies']
	]) {
		await expect(footer.getByRole('link', { name })).toHaveAttribute('href', path);
	}
});

test('keeps the public legal policy index and privacy page available', async ({ page }) => {
	await page.goto('/legal');
	await page.getByRole('listitem').getByRole('link', { name: 'Privacy Policy' }).click();
	await expect(page).toHaveURL(/\/legal\/privacy$/);
	await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
});

test('links from legal pages to the live pricing section', async ({ page }) => {
	await page.goto('/legal');
	await expect(page.locator('a[href$="#features"], a[href$="#how-it-works"]')).toHaveCount(0);
	await page.getByRole('contentinfo').getByRole('link', { name: 'Pricing' }).click();
	await expect(page).toHaveURL(new URL('/#pricing', page.url()).href);
	await expect(
		page.getByRole('heading', { name: 'Free forever locally, pay for sync' })
	).toBeInViewport();
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

test('serves localized landing pages and reciprocal search metadata without JavaScript', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://maal.is/');
	await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
		'content',
		'https://maal.is/social.png'
	);
	await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
		'content',
		'summary_large_image'
	);
	const schema = JSON.parse(
		(await page.locator('script[type="application/ld+json"]').textContent())!
	);
	expect(schema['@graph']).toEqual([
		expect.objectContaining({ '@type': 'Organization' }),
		expect.objectContaining({
			'@type': 'SoftwareApplication',
			offers: expect.objectContaining({ price: 0 })
		})
	]);
	await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(11);
	const dutchUrl = 'https://maal.is/nl/';
	await expect(page.locator('link[hreflang="nl"]')).toHaveAttribute('href', dutchUrl);
	await page.getByRole('link', { name: 'Nederlands' }).click();
	await expect(page).toHaveURL(/\/nl\/$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Avondeten plannen mag anders lopen'
	);
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', dutchUrl);
	for (const language of ['en', 'x-default']) {
		await expect(page.locator(`link[hreflang="${language}"]`)).toHaveAttribute(
			'href',
			'https://maal.is/'
		);
	}
	await page.getByRole('link', { name: 'English' }).click();
	await expect(page).toHaveURL(new URL('/', page.url()).href);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await context.close();
});

test('serves only localized public URLs in the sitemap and discourages preview indexing', async ({
	request
}) => {
	const sitemap = await request.get('/sitemap.xml');
	expect(sitemap.ok()).toBe(true);
	expect(sitemap.headers()['content-type']).toContain('application/xml');
	const xml = await sitemap.text();
	expect(xml.match(/<loc>/g)).toHaveLength(10);
	expect(xml).toContain('<loc>https://maal.is/nl/</loc>');
	expect(xml).toContain('hreflang="x-default" href="https://maal.is/"');
	expect(xml).not.toContain('/plan');
	const robots = await request.get('/robots.txt');
	expect(await robots.text()).toBe('User-agent: *\nAllow: /\n');
	expect(robots.headers()['x-robots-tag']).toBe('noindex');
	expect((await request.get('/')).headers()['x-robots-tag']).toBe('noindex');
	const plan = await request.get('/plan');
	expect(await plan.text()).toContain('<meta name="robots" content="noindex"');
	expect((await request.get('/social.png')).ok()).toBe(true);
});

test('keeps the old auth callback redirect from the homepage', async ({ request }) => {
	const query = '?authSlot=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&authStatus=authenticated';
	const response = await request.get(`/${query}`, { maxRedirects: 0 });
	expect(response.status()).toBe(307);
	expect(response.headers().location).toBe(`/plan${query}`);
});
