import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { uuidv7 } from 'uuidv7';

import { openMaalDatabase } from '$lib/client/local/database.js';
import { createRecipeFromEditor } from '$lib/client/recipes/commands.js';
import { confirmUrlImport } from '$lib/client/recipes/url-import.js';
import MyMenuDashboard from '$lib/components/menu/my-menu-dashboard.svelte';
import { myMenuRecipes } from '$lib/components/menu/my-menu-fixtures.js';
import type { RecipeImportedCandidate } from '$lib/domain/recipes/schema.js';
import type { RecipeMenuItem } from '$lib/menu/menu-types.js';
import {
	importedCandidateToMenuItem,
	recipeAggregateToMenuItem,
	recipeMenuItemToEditorPatch
} from '$lib/menu/recipe-local-adapter.js';
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

test.each(['draft', 'existing'])(
	'preserves parsed URL import data when saving a %s recipe',
	async (kind) => {
		const database = await openMaalDatabase(`sheet-import-${crypto.randomUUID()}`);
		try {
			const context = {
				authSlotId: 'slot-alice',
				ownerUserId: 'user_alice',
				originDeviceId: uuidv7()
			};
			const original = await createRecipeFromEditor(
				database,
				context,
				recipeMenuItemToEditorPatch(myMenuRecipes[0]!)
			);
			const imported: RecipeImportedCandidate = {
				...original,
				title: 'Imported tomato soup',
				sourceUrl: 'https://example.com/soup',
				sourceHtmlHash: 'sha256:imported',
				parseConfidence: 0.9,
				instructionEvents: [
					{
						id: uuidv7(),
						recipeInstructionId: original.instructions[0]!.id,
						kind: 'action',
						appliance: null,
						sourceText: 'Simmer',
						value: null,
						unitId: null,
						baseValue: null,
						baseUnitId: null,
						confidence: 0.9,
						createdAt: original.createdAt
					}
				],
				classifications: [
					{
						id: uuidv7(),
						kind: 'diet',
						value: 'Vegetarian',
						normalizedValue: 'vegetarian',
						schemaOrgValue: null,
						locale: 'en',
						confidence: 1,
						createdAt: original.createdAt
					}
				],
				nutritionFacts: [
					{
						id: uuidv7(),
						nutrient: 'calories',
						schemaOrgProperty: 'calories',
						originalText: '200 kcal',
						amount: 200,
						unitId: null,
						baseAmount: null,
						baseUnitId: null,
						locale: 'en',
						confidence: 1,
						createdAt: original.createdAt,
						updatedAt: original.updatedAt
					}
				]
			};
			const onimporturl = vi.fn(async () =>
				importedCandidateToMenuItem(imported, 'draft-recipe-import')
			);
			const onsave = vi.fn(async (recipe: RecipeMenuItem) => {
				if (recipe.importedCandidate) {
					await confirmUrlImport(database, context, recipe.importedCandidate, recipe);
				}
			});
			const screen = await render(MyMenuDashboard, {
				recipes: [recipeAggregateToMenuItem(original)],
				onimporturl,
				onsave
			});
			await screen
				.getByRole('button', {
					name: kind === 'draft' ? 'Add recipe' : `Open ${original.title}`
				})
				.click();
			await page.getByRole('textbox', { name: /^Source URL/ }).fill('https://example.com/soup');
			await page.getByRole('button', { name: 'Import', exact: true }).click();
			await expect
				.element(page.getByLabelText('Title', { exact: true }))
				.toHaveValue(imported.title);
			await page.getByLabelText('Title', { exact: true }).fill('Edited imported soup');
			await page.getByRole('button', { name: 'Save recipe' }).click();
			await expect.poll(() => onsave.mock.calls.length).toBe(1);
			expect(onimporturl).toHaveBeenCalledWith(imported.sourceUrl);
			expect(onsave.mock.calls[0]?.[0].importedCandidate).toEqual(imported);
			if (kind === 'existing') expect(onsave.mock.calls[0]?.[0].id).toBe(original.id);
			await expect
				.poll(async () =>
					(await database.recipes.toArray()).find(
						(recipe) => 'title' in recipe && recipe.title === 'Edited imported soup'
					)
				)
				.toMatchObject({
					sourceHtmlHash: imported.sourceHtmlHash,
					instructionEvents: imported.instructionEvents,
					classifications: imported.classifications,
					nutritionFacts: imported.nutritionFacts
				});
			expect(await database.recipes.count()).toBe(kind === 'draft' ? 2 : 1);

			await screen.getByRole('button', { name: 'Add recipe' }).click();
			await page.getByLabelText('Title', { exact: true }).fill('Manual recipe');
			await page.getByRole('button', { name: 'Save recipe' }).click();
			await expect.poll(() => onsave.mock.calls.length).toBe(2);
			expect(onsave.mock.calls[1]?.[0].importedCandidate).toBeUndefined();
		} finally {
			await database.delete();
		}
	}
);

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
