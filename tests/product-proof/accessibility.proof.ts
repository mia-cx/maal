import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { openSettings, seedProduct } from './fixture.js';

type ProductView = {
	name: string;
	open: (page: Page) => Promise<void>;
};

const productViews: ProductView[] = [
	{
		name: 'dashboard',
		open: async (page) => {
			await page.goto('/plan');
			await expect(page.getByRole('region', { name: 'Multi-day schedule' })).toBeVisible();
		}
	},
	{
		name: 'recipes',
		open: async (page) => {
			await page.goto('/menu');
			await expect(page.getByRole('button', { name: 'Add recipe' })).toBeVisible();
		}
	},
	{
		name: 'profiles',
		open: async (page) => {
			await openSettings(page, 'account');
			await expect(page.getByText('Profiles on this device', { exact: true })).toBeVisible();
		}
	},
	{
		name: 'household settings and preferences',
		open: async (page) => {
			await page.goto('/household');
			await expect(page.getByRole('heading', { name: 'Household settings' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Aliases & overrides' })).toBeVisible();
		}
	},
	{
		name: 'billing',
		open: async (page) => {
			await openSettings(page, 'billing');
			await expect(page.getByRole('region', { name: 'Billing' })).toBeVisible();
		}
	},
	{
		name: 'recovery',
		open: async (page) => {
			await page.goto('/recovery');
			await expect(
				page.getByRole('heading', { level: 1, name: 'Save your readable data first' })
			).toBeVisible();
		}
	}
];

const expectVisibleKeyboardFocus = async (page: Page): Promise<void> => {
	await page.keyboard.press('Tab');
	const focused = page.locator(':focus-visible');
	await expect(focused).toHaveCount(1);
	const evidence = await focused.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			boxShadow: style.boxShadow,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
			tagName: element.tagName
		};
	});
	expect(evidence.tagName).not.toBe('BODY');
	expect(
		evidence.boxShadow !== 'none' ||
			(evidence.outlineStyle !== 'none' && evidence.outlineWidth !== '0px')
	).toBe(true);
};

for (const colorScheme of ['light', 'dark'] as const) {
	test.describe(`${colorScheme} appearance`, () => {
		test.use({ colorScheme });

		for (const productView of productViews) {
			test(`${productView.name} has no detectable WCAG A or AA violations and shows keyboard focus`, async ({
				page
			}) => {
				await seedProduct(page);
				await productView.open(page);
				expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
					colorScheme === 'dark'
				);
				if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
				else await expect(page.locator('html')).not.toHaveClass(/dark/);
				await expectVisibleKeyboardFocus(page);

				const results = await new AxeBuilder({ page })
					.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
					.analyze();
				expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
			});
		}
	});
}
