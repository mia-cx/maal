import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import MyMenuDashboard from '$lib/components/menu/my-menu-dashboard.svelte';
import { myMenuRecipes } from '$lib/components/menu/my-menu-fixtures.js';
import type { RecipeMenuItem } from '$lib/menu/menu-types.js';
import '../../src/routes/layout.css';

test('preserves the approved recipe library and editor interactions', async () => {
	const onsave = vi.fn<(recipe: RecipeMenuItem) => void>();
	const screen = await render(MyMenuDashboard, { recipes: myMenuRecipes.slice(0, 2), onsave });

	await expect
		.element(screen.getByRole('button', { name: 'Open Chicken rice bowls' }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Add recipe' }).click();
	await expect.element(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible();
	await page.getByLabelText('Title').fill('Freezer tomato soup');
	await page.getByRole('textbox', { name: 'Ingredient 1', exact: true }).fill('tomatoes');
	await page.getByRole('button', { name: 'Save recipe' }).click();

	await expect.poll(() => onsave.mock.calls.length).toBe(1);
	expect(onsave.mock.calls[0]?.[0]).toMatchObject({
		title: 'Freezer tomato soup',
		ingredients: [{ amount: '', item: 'tomatoes' }]
	});
});

test('loads the next window of recipe cards as the list scrolls', async () => {
	const recipes = Array.from({ length: 300 }, (_, index) => ({
		...myMenuRecipes[0]!,
		id: `scroll-recipe-${index}`,
		title: `Scroll recipe ${index}`
	}));
	const screen = await render(MyMenuDashboard, { recipes });
	const cards = screen.getByRole('button', { name: /^Open Scroll recipe/ });

	await expect.poll(() => cards.elements().length).toBe(120);
	expect(screen.getByRole('button', { name: /show more/i }).elements()).toHaveLength(0);

	cards.elements().at(-1)!.scrollIntoView();
	await expect.poll(() => cards.elements().length).toBe(240);
});

test('keeps recovery controls and states that copied meals survive permanent deletion', async () => {
	const onrestore = vi.fn<(recipe: RecipeMenuItem) => void>();
	const onpermanentdelete = vi.fn<(recipes: RecipeMenuItem[]) => void>();
	const deleted = { ...myMenuRecipes[0]!, archivedAt: '2026-08-20T10:00:00.000Z' };
	const screen = await render(MyMenuDashboard, {
		archivedRecipes: [deleted],
		onrestore,
		onpermanentdelete
	});

	await screen.getByRole('button', { name: 'Deleted recipes (1)' }).click();
	await expect.element(page.getByText('Deleted 2026-08-20')).toBeVisible();
	await page.getByRole('button', { name: 'Delete forever' }).click();
	await expect
		.element(page.getByText(/Meals already copied from Chicken rice bowls stay in the household/))
		.toBeVisible();
	await page.getByRole('button', { name: 'Delete 1 recipe forever' }).click();
	await expect.poll(() => onpermanentdelete.mock.calls.length).toBe(1);
	expect(onrestore).not.toHaveBeenCalled();
});
