import { expect, test } from '@playwright/test';

import budgets from '../../performance-budgets.json' with { type: 'json' };
import { seedProduct } from './fixture.js';

const installPerformanceObservers = () => {
	const state = {
		layoutShift: 0,
		longTasks: [] as number[]
	};
	Object.defineProperty(window, '__maalProofMetrics', { value: state, configurable: true });
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
				if (!shift.hadRecentInput) state.layoutShift += shift.value ?? 0;
			}
		}).observe({ type: 'layout-shift', buffered: true });
	} catch {
		// The Chromium proof project supports layout-shift entries. Keep the fallback explicit.
	}
	try {
		new PerformanceObserver((list) => {
			state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
		}).observe({ type: 'longtask', buffered: true });
	} catch {
		// The Chromium proof project supports longtask entries. Keep the fallback explicit.
	}
};

test('meets the shell render, interaction, long-task, and CLS budgets', async ({
	page
}, testInfo) => {
	await page.addInitScript(installPerformanceObservers);
	await seedProduct(page);
	await expect(page.getByRole('region', { name: 'Multi-day schedule' })).toBeVisible();
	const shellRenderMs = await page.evaluate(() => performance.now());
	await page.waitForTimeout(100);
	const cumulativeLayoutShift = await page.evaluate(
		() =>
			(
				window as typeof window & {
					__maalProofMetrics: { layoutShift: number; longTasks: number[] };
				}
			).__maalProofMetrics.layoutShift
	);

	await page.evaluate(() => {
		(
			window as typeof window & {
				__maalProofMetrics: { layoutShift: number; longTasks: number[] };
			}
		).__maalProofMetrics.longTasks = [];
	});
	const interactionResponseMs = await page
		.getByRole('button', { name: 'Month', exact: true })
		.evaluate(async (button) => {
			const startedAt = performance.now();
			return new Promise<number>((resolve, reject) => {
				const timeout = window.setTimeout(
					() => reject(new Error('The monthly schedule did not render.')),
					500
				);
				const observer = new MutationObserver(() => {
					if (!document.querySelector('[role="region"][aria-label="Monthly schedule"]')) return;
					window.clearTimeout(timeout);
					observer.disconnect();
					resolve(performance.now() - startedAt);
				});
				observer.observe(document.body, { childList: true, subtree: true });
				(button as HTMLButtonElement).click();
			});
		});
	await page.waitForTimeout(0);
	const interactionLongTasks = await page.evaluate(
		() =>
			(
				window as typeof window & {
					__maalProofMetrics: { layoutShift: number; longTasks: number[] };
				}
			).__maalProofMetrics.longTasks
	);
	const maxInteractionTaskMs = Math.max(0, ...interactionLongTasks);
	await testInfo.attach('shell-performance.json', {
		body: JSON.stringify(
			{ shellRenderMs, interactionResponseMs, maxInteractionTaskMs, cumulativeLayoutShift },
			null,
			2
		),
		contentType: 'application/json'
	});

	expect(shellRenderMs).toBeLessThanOrEqual(budgets.initialShellRenderMs);
	expect(interactionResponseMs).toBeLessThanOrEqual(budgets.interactionResponseMs);
	expect(maxInteractionTaskMs).toBeLessThanOrEqual(budgets.maxInteractionTaskMs);
	expect(cumulativeLayoutShift).toBeLessThanOrEqual(budgets.maxCumulativeLayoutShift);
});

test('searches a 10,000-recipe local library within the interaction budgets', async ({
	page
}, testInfo) => {
	test.setTimeout(60_000);
	await page.addInitScript(installPerformanceObservers);
	await seedProduct(page, {
		recipeCount: budgets.menuRecipeFixtureSize,
		targetPath: '/menu'
	});
	const search = page.getByPlaceholder('Search recipes…');
	await expect(search).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'Open Gingery chicken rice bowls' })).toBeVisible({
		timeout: 30_000
	});
	const initialRenderedRecipes = await page.getByRole('button', { name: /^Open / }).count();
	expect(initialRenderedRecipes).toBeLessThanOrEqual(120);
	await page.evaluate(() => {
		(
			window as typeof window & {
				__maalProofMetrics: { layoutShift: number; longTasks: number[] };
			}
		).__maalProofMetrics.longTasks = [];
	});

	const interactionResponseMs = await search.evaluate(async (input) => {
		const startedAt = performance.now();
		return new Promise<number>((resolve, reject) => {
			const targetName = 'Open Kitchen recipe 10000';
			const findTarget = () =>
				Array.from(document.querySelectorAll('button')).some(
					(button) => button.getAttribute('aria-label') === targetName
				);
			const timeout = window.setTimeout(
				() => reject(new Error('Recipe result did not render.')),
				500
			);
			const observer = new MutationObserver(() => {
				if (!findTarget()) return;
				window.clearTimeout(timeout);
				observer.disconnect();
				resolve(performance.now() - startedAt);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			const field = input as HTMLInputElement;
			field.value = 'Kitchen recipe 10000';
			field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
		});
	});
	await expect(page.getByRole('button', { name: 'Open Kitchen recipe 10000' })).toBeVisible();
	await page.waitForTimeout(0);
	const longestTaskMs = await page.evaluate(() =>
		Math.max(
			0,
			...(
				window as typeof window & {
					__maalProofMetrics: { layoutShift: number; longTasks: number[] };
				}
			).__maalProofMetrics.longTasks
		)
	);
	await testInfo.attach('ten-thousand-recipes.json', {
		body: JSON.stringify(
			{
				fixtureSize: budgets.menuRecipeFixtureSize,
				initialRenderedRecipes,
				interactionResponseMs,
				longestTaskMs
			},
			null,
			2
		),
		contentType: 'application/json'
	});

	expect(interactionResponseMs).toBeLessThanOrEqual(budgets.interactionResponseMs);
	expect(longestTaskMs).toBeLessThanOrEqual(budgets.maxInteractionTaskMs);
});
