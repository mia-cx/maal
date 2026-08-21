import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	deleteMeal,
	defaultScheduleUiState,
	detachDeletedRecipeFromMeals,
	listHouseholdMeals,
	planRecipeAsMeal,
	readScheduleUiState,
	saveMealCheckIn,
	updateMealSchedule,
	writeScheduleUiState,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { MaalDatabase, openMaalDatabase } from '$lib/client/local/database.js';
import {
	commitImportedRecipeCandidate,
	updateRecipeFromEditor,
	type RecipeCommandContext
} from '$lib/client/recipes/index.js';
import { MealCheckInSchema } from '$lib/domain/meals/schema.js';
import {
	RecipeImportedCandidateSchema,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';

const databases: MaalDatabase[] = [];
const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`meals-${crypto.randomUUID()}`);
	databases.push(database);
	return database;
};

afterEach(async () => {
	vi.useRealTimers();
	for (const database of databases) {
		const name = database.name;
		database.close();
		await Dexie.delete(name);
	}
	databases.length = 0;
});

const at = (day: number): `${string}Z` => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const deviceId = uuidv7();

const recipeContext = (occurredAt = at(20)): RecipeCommandContext => ({
	authSlotId: 'slot-alice',
	ownerUserId: 'user_alice',
	originDeviceId: deviceId,
	occurredAt
});

const mealContext = (occurredAt = at(21)): MealCommandContext => ({
	authSlotId: 'slot-alice',
	householdId: 'org_family',
	reporterUserId: 'user_alice',
	originDeviceId: deviceId,
	occurredAt
});

const completeRecipe = (): RecipeImportedCandidate => {
	const instructionId = uuidv7();
	return Schema.decodeUnknownSync(RecipeImportedCandidateSchema)({
		savedFromHouseholdId: 'org_family',
		title: 'Sunday soup',
		description: 'A complete snapshot fixture.',
		imageUrl: 'https://images.example/soup.jpg',
		prepTimeMinutes: 12,
		cookTimeMinutes: 33,
		totalTimeMinutes: 45,
		yield: 4,
		sourceYieldText: 'Serves four',
		sourceClaimedMinutes: 45,
		sourceDatePublished: '2024-01-02',
		sourceDateModified: '2025-03-04',
		sourceLanguage: 'en-GB',
		sourceUrl: 'https://example.com/soup',
		sourceSiteName: 'Example Kitchen',
		sourceAuthorName: 'Alex Cook',
		sourcePublisherName: 'Example Media',
		sourceIsBasedOnUrl: 'https://example.com/family-soup',
		sourceImportedAt: at(19),
		sourceHtmlHash: 'sha256:complete',
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
				baseFoodId: null,
				baseQuantity: 800,
				baseUnitId: 'unit_g',
				baseUnitFamilyId: 'unit_g',
				optional: false,
				confidence: 0.93,
				createdAt: at(19)
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
				createdAt: at(19),
				updatedAt: at(19)
			}
		],
		instructionEvents: [
			{
				id: uuidv7(),
				recipeInstructionId: instructionId,
				kind: 'action',
				appliance: null,
				sourceText: 'Simmer',
				value: null,
				unitId: null,
				baseValue: null,
				baseUnitId: null,
				confidence: 0.94,
				createdAt: at(19)
			}
		],
		applianceRequirements: [
			{
				id: uuidv7(),
				appliance: 'stovetop',
				required: true,
				source: 'instruction_heuristic',
				confidence: 0.9,
				notes: 'Medium heat',
				createdAt: at(19),
				updatedAt: at(19)
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
				createdAt: at(19)
			}
		],
		media: [
			{
				id: uuidv7(),
				kind: 'image',
				position: 0,
				url: 'https://example.com/image.jpg',
				contentUrl: null,
				embedUrl: null,
				thumbnailUrl: null,
				name: 'Soup',
				caption: 'In a blue bowl',
				createdAt: at(19)
			}
		],
		nutritionFacts: [
			{
				id: uuidv7(),
				nutrient: 'sodium',
				schemaOrgProperty: 'sodiumContent',
				originalText: '450 mg sodium',
				amount: 450,
				unitId: null,
				baseAmount: null,
				baseUnitId: null,
				locale: 'en-GB',
				confidence: 0.89,
				createdAt: at(19),
				updatedAt: at(19)
			}
		]
	});
};

describe('lossless local meal snapshots', () => {
	test('clones the complete recipe and remains independent after recipe edits and provenance detach', async () => {
		const database = await openDatabase();
		const candidate = completeRecipe();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), candidate);
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			time: '18:30',
			sortOrder: 1000,
			plannedYield: 6
		});

		expect(meal.id).not.toBe(recipe.id);
		expect(meal.sourceRecipeId).toBe(recipe.id);
		expect(meal.applianceRequirements).toHaveLength(1);
		expect(meal.instructionEvents).toHaveLength(1);
		expect(meal.classifications).toHaveLength(1);
		expect(meal.media).toHaveLength(1);
		expect(meal.nutritionFacts).toHaveLength(1);
		expect(meal.instructions[0]?.id).not.toBe(recipe.instructions[0]?.id);
		expect(meal.instructionEvents[0]?.mealInstructionId).toBe(meal.instructions[0]?.id);
		expect(meal.sourceHtmlHash).toBe('sha256:complete');
		expect(meal.notes).toBe('Use the wide pot.');

		await updateRecipeFromEditor(database, recipeContext(at(22)), recipe.id, {
			title: 'Changed soup',
			description: null,
			imageUrl: null,
			sourceUrl: null,
			sourceSiteName: null,
			sourceAuthorName: null,
			sourcePublisherName: null,
			sourceIsBasedOnUrl: null,
			prepTimeMinutes: null,
			cookTimeMinutes: 5,
			yield: 2,
			ingredients: [],
			instructions: []
		});
		expect((await listHouseholdMeals(database, 'org_family'))[0]?.title).toBe('Sunday soup');
		expect(await database.recipes.count()).toBe(1);

		await detachDeletedRecipeFromMeals(database, mealContext(at(23)), recipe.id);
		const detached = (await listHouseholdMeals(database, 'org_family'))[0]!;
		expect(detached.sourceRecipeId).toBeNull();
		expect(detached.title).toBe('Sunday soup');
		expect(detached.ingredients).toHaveLength(1);
	});
});

describe('meal lifecycle and focused check-ins', () => {
	test('postpones as planned, stores status separately, and preserves check-in history on deletion', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			time: '18:30'
		});
		const postponed = await updateMealSchedule(database, mealContext(at(22)), meal.id, {
			date: '2026-08-25',
			time: '19:15',
			sortOrder: 2000
		});
		expect(postponed.status).toBe('planned');

		const checkedIn = await saveMealCheckIn(database, mealContext(at(23)), meal.id, {
			status: 'cooked',
			verdict: 'repeat',
			cookTimeMinutes: 41,
			reason: 'Good enough for Tuesday.'
		});
		expect(checkedIn.meal.status).toBe('cooked');
		expect(checkedIn.checkIn).toMatchObject({
			mealId: meal.id,
			verdict: 'repeat',
			cookTimeMinutes: 41,
			reason: 'Good enough for Tuesday.'
		});
		expect(checkedIn.checkIn).not.toHaveProperty('cooked');
		expect(await database.outbox.count()).toBe(4);

		await deleteMeal(database, mealContext(at(24)), meal.id);
		expect(await listHouseholdMeals(database, 'org_family')).toEqual([]);
		const historical = Schema.decodeUnknownSync(MealCheckInSchema)(
			await database.mealCheckIns.get(checkedIn.checkIn.id)
		);
		expect(historical.mealId).toBeNull();
		expect(historical.reason).toBe('Good enough for Tuesday.');
	});
});

describe('profile and household scoped schedule UI state', () => {
	test('uses the household timezone for a fresh schedule anchor', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-21T23:30:00.000Z'));
		expect(defaultScheduleUiState('Pacific/Kiritimati').scheduleAnchorDate).toBe('2026-08-22');
		expect(defaultScheduleUiState('America/Los_Angeles').scheduleAnchorDate).toBe('2026-08-21');
	});

	test('does not bleed mode, anchor, or daily offsets across profiles or households', async () => {
		const database = await openDatabase();
		await writeScheduleUiState(database, 'profile-alice', 'org-family', {
			scheduleMode: 'daily',
			scheduleAnchorDate: '2026-08-25',
			dailyScroll: { date: '2026-08-25', offset: 384 }
		});
		expect(await readScheduleUiState(database, 'profile-alice', 'org-family')).toEqual({
			scheduleMode: 'daily',
			scheduleAnchorDate: '2026-08-25',
			dailyScroll: { date: '2026-08-25', offset: 384 }
		});
		expect((await readScheduleUiState(database, 'profile-bob', 'org-family')).scheduleMode).toBe(
			'multi-day'
		);
		expect(
			(await readScheduleUiState(database, 'profile-alice', 'org-other')).dailyScroll
		).toBeNull();
	});
});
