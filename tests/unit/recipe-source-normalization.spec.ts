import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	createRecipeFromEditor,
	updateRecipeFromEditor,
	type RecipeEditorPatch
} from '$lib/client/recipes/index.js';
import {
	importedCandidateToMenuItem,
	mergeEditorIntoImportedCandidate
} from '$lib/menu/recipe-local-adapter.js';
import { parseRecipeCandidate } from '$lib/server/recipe-import/parser.js';

const now = '2026-08-22T08:00:00.000Z';

const databases: MaalDatabase[] = [];
afterEach(async () => {
	for (const database of databases) {
		database.close();
		await Dexie.delete(database.name);
	}
	databases.length = 0;
});

const importRecipe = (ingredients: string[], instructions: string[]) =>
	parseRecipeCandidate({
		html: `<script type="application/ld+json">${JSON.stringify({
			'@type': 'Recipe',
			name: 'Bread',
			recipeIngredient: ingredients,
			recipeInstructions: instructions
		})}</script>`,
		finalUrl: 'https://example.com/bread',
		now
	});

const editorPatch = (
	ingredients: RecipeEditorPatch['ingredients'],
	instructions: RecipeEditorPatch['instructions']
): RecipeEditorPatch => ({
	title: 'Bread',
	description: null,
	imageUrl: null,
	sourceUrl: null,
	sourceSiteName: null,
	sourceAuthorName: null,
	sourcePublisherName: null,
	sourceIsBasedOnUrl: null,
	prepTimeMinutes: null,
	cookTimeMinutes: null,
	yield: null,
	ingredients,
	instructions
});

const context = {
	authSlotId: 'slot-alice',
	ownerUserId: 'user_alice',
	originDeviceId: uuidv7(),
	occurredAt: now
} as const;

describe('URL import', () => {
	test('splits ingredient lines and resolves seed units, keeping the source line', async () => {
		const candidate = await importRecipe(
			['1 1/2 cups flour', '½ tsp salt', '2 large eggs', '1 T sugar'],
			['Mix.']
		);
		expect(candidate.ingredients).toEqual([
			expect.objectContaining({
				originalText: '1 1/2 cups flour',
				sourceAmountText: '1 1/2',
				sourceQuantity: 1.5,
				sourceUnitLabel: 'cup',
				sourceFoodLabel: 'flour',
				baseFoodId: null,
				baseQuantity: 1.5,
				baseUnitId: 'cups',
				baseUnitFamilyId: 'milliliters'
			}),
			expect.objectContaining({
				sourceAmountText: '½',
				sourceQuantity: 0.5,
				sourceUnitLabel: 'tsp',
				sourceFoodLabel: 'salt',
				baseUnitId: 'teaspoons',
				baseUnitFamilyId: 'milliliters'
			}),
			expect.objectContaining({
				originalText: '2 large eggs',
				sourceAmountText: '2',
				sourceQuantity: 2,
				sourceUnitLabel: null,
				sourceFoodLabel: 'large eggs',
				baseUnitId: null,
				baseUnitFamilyId: null
			}),
			// "T" (tablespoon) and "t" (teaspoon) collide case-insensitively, so neither is guessed.
			expect.objectContaining({ sourceQuantity: 1, sourceUnitLabel: null, baseUnitId: null })
		]);
	});

	test('review edits re-derive changed ingredient lines and keep untouched ones', async () => {
		const candidate = await importRecipe(['1 cup flour'], ['Mix.']);
		const draft = importedCandidateToMenuItem(candidate, uuidv7());
		const merged = mergeEditorIntoImportedCandidate(candidate, {
			...draft,
			ingredients: draft.ingredients?.map((row) => ({ ...row, amount: '2 1/2' }))
		});
		expect(merged.ingredients[0]).toMatchObject({
			sourceAmountText: '2 1/2',
			sourceQuantity: 2.5,
			baseQuantity: 2.5,
			baseUnitId: 'cups'
		});
	});
});

describe('editor save', () => {
	test('parses fractional amounts and seed units on create and edit', async () => {
		const database = await openMaalDatabase(`recipe-normalization-${crypto.randomUUID()}`);
		databases.push(database);
		const created = await createRecipeFromEditor(
			database,
			context,
			editorPatch(
				[{ id: null, amount: '1 1/2', unit: 'cups', item: 'flour' }],
				[{ id: null, position: 1, text: 'Mix.' }]
			)
		);
		expect(created.ingredients[0]).toMatchObject({
			originalText: '1 1/2 cups flour',
			sourceAmountText: '1 1/2',
			sourceQuantity: 1.5,
			sourceUnitLabel: 'cups',
			sourceFoodLabel: 'flour',
			baseQuantity: 1.5,
			baseUnitId: 'cups',
			baseUnitFamilyId: 'milliliters'
		});

		const instruction = created.instructions[0]!;
		const updated = await updateRecipeFromEditor(
			database,
			{ ...context, occurredAt: '2026-08-23T08:00:00.000Z' },
			created.id,
			editorPatch(
				[{ id: created.ingredients[0]!.id, amount: '¾', unit: 'cups', item: 'flour' }],
				[{ id: instruction.id, position: 1, text: 'Mix.' }]
			)
		);
		expect(updated.ingredients[0]).toMatchObject({ sourceQuantity: 0.75, baseQuantity: 0.75 });
	});
});
