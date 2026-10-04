import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	commitImportedRecipeCandidate,
	createRecipeFromEditor,
	deleteRecipe,
	listRecoverableRecipes,
	listRecipes,
	permanentlyDeleteRecipe,
	restoreRecipe,
	runForegroundRecipeRetention,
	runRecipeRetention,
	searchRecipes,
	updateRecipeFromEditor,
	type RecipeCommandContext,
	type RecipeEditorPatch
} from '$lib/client/recipes/index.js';
import { MaalDatabase, openMaalDatabase } from '$lib/client/local/database.js';
import {
	RecipeImportedCandidateSchema,
	StoredRecipeSchema,
	isRecipeAggregate,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';

const databases: MaalDatabase[] = [];

const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`recipes-${crypto.randomUUID()}`);
	databases.push(database);
	return database;
};

afterEach(async () => {
	for (const database of databases) {
		const name = database.name;
		database.close();
		await Dexie.delete(name);
	}
	databases.length = 0;
});

const at = (day: number): `${string}Z` => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;

const context = (occurredAt = at(21)): RecipeCommandContext => ({
	authSlotId: 'slot-alice',
	ownerUserId: 'user_alice',
	originDeviceId: uuidv7(),
	occurredAt
});

const importedCandidate = (): RecipeImportedCandidate => {
	const instructionId = uuidv7();
	return Schema.decodeUnknownSync(RecipeImportedCandidateSchema)({
		savedFromHouseholdId: 'org_family',
		title: 'Crème tomato soup',
		description: 'Silky soup',
		imageUrl: 'https://images.example/soup.jpg',
		prepTimeMinutes: 8,
		cookTimeMinutes: 35,
		totalTimeMinutes: 43,
		yield: 4,
		sourceYieldText: 'Serves four generously',
		sourceClaimedMinutes: 45,
		sourceDatePublished: '2024-01-02',
		sourceDateModified: '2025-03-04',
		sourceLanguage: 'en-GB',
		sourceUrl: 'https://example.com/original-soup',
		sourceSiteName: 'Example Kitchen',
		sourceAuthorName: 'Alex Cook',
		sourcePublisherName: 'Example Media',
		sourceIsBasedOnUrl: 'https://example.com/family-soup',
		sourceImportedAt: at(20),
		sourceHtmlHash: 'sha256:source-fidelity',
		sourceRatingValue: 4.7,
		sourceRatingCount: 81,
		sourceReviewCount: 74,
		parseConfidence: 0.91,
		ingredientConfidence: 0.82,
		instructionConfidence: 0.73,
		nutritionConfidence: 0.64,
		userNotes: 'Use the wide pot.',
		ingredients: [
			{
				id: uuidv7(),
				lineIndex: 0,
				originalText: '800 g tomatoes',
				sourceAmountText: '800',
				sourceQuantity: 800,
				sourceUnitLabel: 'g',
				sourceFoodLabel: 'tomatoes',
				baseFoodId: 'food_tomato',
				baseQuantity: 800,
				baseUnitId: 'unit_g',
				baseUnitFamilyId: 'unit_g',
				optional: false,
				confidence: 0.93,
				createdAt: at(20)
			}
		],
		instructions: [
			{
				id: instructionId,
				stepIndex: 0,
				sectionName: 'Soup',
				text: 'Simmer for 20 minutes.',
				durationMinutes: 20,
				confidence: 0.88,
				createdAt: at(20),
				updatedAt: at(20)
			}
		],
		instructionEvents: [
			{
				id: uuidv7(),
				recipeInstructionId: instructionId,
				kind: 'duration',
				appliance: null,
				sourceText: '20 minutes',
				value: 20,
				unitId: 'unit_minute',
				baseValue: 1200,
				baseUnitId: 'unit_second',
				confidence: 0.94,
				createdAt: at(20)
			}
		],
		applianceRequirements: [
			{
				id: uuidv7(),
				appliance: 'stovetop',
				required: true,
				source: 'instruction_heuristic',
				confidence: 0.9,
				notes: 'Use medium heat.',
				createdAt: at(20),
				updatedAt: at(20)
			}
		],
		classifications: [
			{
				id: uuidv7(),
				kind: 'diet',
				value: 'Vegetarian',
				normalizedValue: 'vegetarian',
				schemaOrgValue: 'https://schema.org/VegetarianDiet',
				locale: 'en-GB',
				confidence: 0.99,
				createdAt: at(20)
			}
		],
		media: [
			{
				id: uuidv7(),
				kind: 'image',
				position: 0,
				url: 'https://example.com/source-image',
				contentUrl: 'https://cdn.example.com/full.jpg',
				embedUrl: null,
				thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
				name: 'Finished soup',
				caption: 'Served in a blue bowl',
				createdAt: at(20)
			}
		],
		nutritionFacts: [
			{
				id: uuidv7(),
				nutrient: 'sodium',
				schemaOrgProperty: 'sodiumContent',
				originalText: '450 mg sodium',
				amount: 450,
				unitId: 'unit_milligram',
				baseAmount: 0.45,
				baseUnitId: 'unit_gram',
				locale: 'en-GB',
				confidence: 0.89,
				createdAt: at(20),
				updatedAt: at(20)
			}
		]
	});
};

const editorPatch = (candidate: RecipeImportedCandidate): RecipeEditorPatch => ({
	title: candidate.title,
	description: candidate.description,
	imageUrl: candidate.imageUrl,
	sourceUrl: candidate.sourceUrl,
	sourceSiteName: candidate.sourceSiteName,
	sourceAuthorName: candidate.sourceAuthorName,
	sourcePublisherName: candidate.sourcePublisherName,
	sourceIsBasedOnUrl: candidate.sourceIsBasedOnUrl,
	prepTimeMinutes: candidate.prepTimeMinutes,
	cookTimeMinutes: candidate.cookTimeMinutes,
	yield: candidate.yield,
	ingredients: candidate.ingredients.map((ingredient) => ({
		id: ingredient.id,
		amount: ingredient.sourceAmountText ?? '',
		unit: ingredient.sourceUnitLabel ?? '',
		item: ingredient.sourceFoodLabel
	})),
	instructions: candidate.instructions.map((instruction) => ({
		id: instruction.id,
		position: instruction.stepIndex + 1,
		text: instruction.text
	}))
});

describe('recipe aggregate contract', () => {
	test('rejects instruction-event payloads that do not match their kind', () => {
		const candidate = importedCandidate();
		expect(() =>
			Schema.decodeUnknownSync(RecipeImportedCandidateSchema)({
				...candidate,
				instructionEvents: [{ ...candidate.instructionEvents[0], kind: 'action', value: 20 }]
			})
		).toThrow();
	});

	test('commits an imported candidate losslessly, then preserves hidden fields through editor save', async () => {
		const database = await openDatabase();
		const candidate = importedCandidate();
		const recipe = await commitImportedRecipeCandidate(database, context(), candidate);
		const hiddenBefore = {
			sourceDatePublished: recipe.sourceDatePublished,
			sourceDateModified: recipe.sourceDateModified,
			sourceLanguage: recipe.sourceLanguage,
			sourceHtmlHash: recipe.sourceHtmlHash,
			sourceRatingValue: recipe.sourceRatingValue,
			sourceRatingCount: recipe.sourceRatingCount,
			sourceReviewCount: recipe.sourceReviewCount,
			sourceClaimedMinutes: recipe.sourceClaimedMinutes,
			parseConfidence: recipe.parseConfidence,
			ingredientConfidence: recipe.ingredientConfidence,
			instructionConfidence: recipe.instructionConfidence,
			nutritionConfidence: recipe.nutritionConfidence,
			instructionEvents: recipe.instructionEvents,
			applianceRequirements: recipe.applianceRequirements,
			classifications: recipe.classifications,
			media: recipe.media,
			nutritionFacts: recipe.nutritionFacts
		};

		const updated = await updateRecipeFromEditor(database, context(at(22)), recipe.id, {
			...editorPatch(candidate),
			title: 'Crème tomato soup for Tuesday'
		});

		expect(updated.title).toBe('Crème tomato soup for Tuesday');
		expect({
			sourceDatePublished: updated.sourceDatePublished,
			sourceDateModified: updated.sourceDateModified,
			sourceLanguage: updated.sourceLanguage,
			sourceHtmlHash: updated.sourceHtmlHash,
			sourceRatingValue: updated.sourceRatingValue,
			sourceRatingCount: updated.sourceRatingCount,
			sourceReviewCount: updated.sourceReviewCount,
			sourceClaimedMinutes: updated.sourceClaimedMinutes,
			parseConfidence: updated.parseConfidence,
			ingredientConfidence: updated.ingredientConfidence,
			instructionConfidence: updated.instructionConfidence,
			nutritionConfidence: updated.nutritionConfidence,
			instructionEvents: updated.instructionEvents,
			applianceRequirements: updated.applianceRequirements,
			classifications: updated.classifications,
			media: updated.media,
			nutritionFacts: updated.nutritionFacts
		}).toEqual(hiddenBefore);
		expect(await database.outbox.count()).toBe(2);
	});
});

describe('offline recipe commands and queries', () => {
	test('creates and searches a manual recipe through the normal command path', async () => {
		const database = await openDatabase();
		const recipe = await createRecipeFromEditor(database, context(), {
			title: 'Crème brûlée',
			description: 'Custard with a brittle sugar top',
			imageUrl: 'https://images.example/creme.jpg',
			sourceUrl: null,
			sourceSiteName: null,
			sourceAuthorName: null,
			sourcePublisherName: null,
			sourceIsBasedOnUrl: null,
			prepTimeMinutes: 15,
			cookTimeMinutes: 40,
			yield: 4,
			ingredients: [{ id: null, amount: '500', unit: 'ml', item: 'cream' }],
			instructions: [{ id: null, position: 1, text: 'Bake the custard.' }]
		});

		expect(recipe.id).toMatch(/-7/);
		expect((await listRecipes(database, 'user_alice')).map(({ id }) => id)).toEqual([recipe.id]);
		expect((await searchRecipes(database, 'user_alice', 'creme')).map(({ id }) => id)).toEqual([
			recipe.id
		]);
		expect(await database.outbox.count()).toBe(1);
	});

	test('soft-deletes and restores within the recovery window as new mutations', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, context(), importedCandidate());
		await deleteRecipe(database, context(at(22)), recipe.id);

		expect(await listRecipes(database, 'user_alice')).toEqual([]);
		expect(
			(await listRecoverableRecipes(database, 'user_alice', new Date(at(23)))).map(({ id }) => id)
		).toEqual([recipe.id]);

		const restored = await restoreRecipe(database, context(at(23)), recipe.id);
		expect(restored.deletedAt).toBeNull();
		expect(await database.outbox.count()).toBe(3);
	});

	test('purges only recipe content, retains a one-year marker, and never removes copied meals', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, context(), importedCandidate());
		const copiedMealId = uuidv7();
		await database.meals.put({
			id: copiedMealId,
			householdId: 'org_family',
			sourceRecipeId: recipe.id,
			title: recipe.title,
			schemaVersion: 1,
			revision: 1,
			createdAt: at(21),
			updatedAt: at(21),
			deletedAt: null,
			conflictClocks: {}
		});

		const tombstone = await permanentlyDeleteRecipe(database, context(at(22)), recipe.id);
		expect(tombstone).toMatchObject({
			id: recipe.id,
			ownerUserId: 'user_alice',
			purgeReason: 'permanent_delete',
			purgedAt: at(22)
		});
		expect('title' in tombstone).toBe(false);
		expect('ingredients' in tombstone).toBe(false);
		expect(await database.meals.get(copiedMealId)).toMatchObject({
			id: copiedMealId,
			title: recipe.title
		});
	});

	test('expires deleted content after 30 days and the minimal tombstone after one year', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, context(), importedCandidate());
		await deleteRecipe(database, context('2025-01-01T00:00:00.000Z'), recipe.id);

		const first = await runRecipeRetention(
			database,
			context('2025-02-01T00:00:00.000Z'),
			'2025-02-01T00:00:00.000Z'
		);
		expect(first.purgedRecipeIds).toEqual([recipe.id]);
		const retained = Schema.decodeUnknownSync(StoredRecipeSchema)(
			await database.recipes.get(recipe.id)
		);
		expect(isRecipeAggregate(retained)).toBe(false);

		const second = await runRecipeRetention(
			database,
			context('2026-02-02T00:00:00.000Z'),
			'2026-02-02T00:00:00.000Z'
		);
		expect(second.expiredTombstoneIds).toEqual([]);
		expect(await database.recipes.get(recipe.id)).toBeDefined();

		await database.outbox
			.where('aggregateId')
			.equals(recipe.id)
			.filter(({ operation }) => operation === 'delete')
			.modify({ status: 'acknowledged' });
		const acknowledged = await runRecipeRetention(
			database,
			context('2026-02-02T00:00:00.000Z'),
			'2026-02-02T00:00:00.000Z'
		);
		expect(acknowledged.expiredTombstoneIds).toEqual([recipe.id]);
		expect(await database.recipes.get(recipe.id)).toBeUndefined();
	});

	test('runs bounded retention for retained profiles without contacting the Worker', async () => {
		const database = await openDatabase();
		await database.authSlots.put({
			authSlotId: 'slot-alice',
			profileId: uuidv7(),
			workosUserId: 'user_alice',
			sessionState: 'reauthRequired',
			lastRefreshedAt: null,
			lastVerifiedAt: null,
			nextRetryAt: null,
			retryCount: 0
		});
		const first = await commitImportedRecipeCandidate(database, context(), importedCandidate());
		const second = await commitImportedRecipeCandidate(database, context(), {
			...importedCandidate(),
			title: 'Second soup'
		});
		await deleteRecipe(database, context('2025-01-01T00:00:00.000Z'), first.id);
		await deleteRecipe(database, context('2025-01-02T00:00:00.000Z'), second.id);
		const fetcher = vi.spyOn(globalThis, 'fetch');

		const result = await runForegroundRecipeRetention(
			database,
			new Date('2025-02-02T00:00:00.000Z'),
			1
		);

		expect(result).toMatchObject({
			profileCount: 1,
			purgedRecipeCount: 1,
			hasMore: true
		});
		expect(fetcher).not.toHaveBeenCalled();
		fetcher.mockRestore();
	});
});
