import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
	deleteMeal,
	defaultScheduleUiState,
	liveMealCalendarRange,
	liveMealPool,
	listHouseholdMeals,
	mealAggregateToScheduleMeal,
	mealHeaderCommands,
	mealScheduleCommand,
	membershipsToHouseholdMembers,
	planRecipeAsMeal,
	readMealCalendarRange,
	readMealPool,
	readScheduleUiState,
	reorderMeals,
	saveMealCheckIn,
	updateMealHeader,
	updateMealSchedule,
	writeScheduleUiState,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import { MaalDatabase, openMaalDatabase } from '$lib/client/local/database.js';
import { executeLocalCommands } from '$lib/client/local/commands.js';
import {
	commitImportedRecipeCandidate,
	deleteRecipe,
	permanentlyDeleteRecipe,
	restoreRecipe,
	updateRecipeFromEditor,
	type RecipeCommandContext
} from '$lib/client/recipes/index.js';
import { runRecipeVersionRetention } from '$lib/client/recipes/version-retention.js';
import type { Membership } from '$lib/domain/household/contracts.js';
import {
	MealCheckInSchema,
	StoredMealSchema,
	isRecipeFollowingMeal
} from '$lib/domain/meals/schema.js';
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

const joinHousehold = async (database: MaalDatabase, timezone: string | null = null) => {
	await database.households.put({
		householdId: 'org_family',
		name: 'Family',
		locale: 'en-NL',
		timezone,
		weekStartsOn: 1,
		defaultPlannedYield: 4,
		preferredDinnerTime: null,
		stalenessThresholdMinutes: 180,
		createdByUserId: 'user_alice',
		deletionState: 'active',
		localOnly: false,
		schemaVersion: 1,
		revision: 1,
		createdAt: at(20),
		updatedAt: at(20),
		deletedAt: null,
		conflictClocks: {}
	});
	await database.memberships.put({
		membershipId: 'membership_alice',
		householdId: 'org_family',
		workosUserId: 'user_alice',
		roleSlug: 'admin',
		permissions: ['meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: at(20),
		lastVerifiedAt: at(20),
		updatedAt: at(20),
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
};

const editRecipe = (
	database: MaalDatabase,
	recipeId: string,
	occurredAt: `${string}Z`,
	title = 'Changed soup'
) =>
	updateRecipeFromEditor(database, recipeContext(occurredAt), recipeId, {
		title,
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

const storedMeal = async (database: MaalDatabase, mealId: string) =>
	Schema.decodeUnknownSync(StoredMealSchema)(await database.meals.get(mealId));

const titleOf = async (database: MaalDatabase, mealId: string) =>
	(await listHouseholdMeals(database, 'org_family')).find(({ id }) => id === mealId)?.title;

describe('recipe-following meals', () => {
	test('an unedited meal stores only its reference and live queries show each recipe edit', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			time: '18:30',
			sortOrder: 1000,
			plannedYield: 6
		});

		const stored = await storedMeal(database, meal.id);
		expect(isRecipeFollowingMeal(stored)).toBe(true);
		expect(stored).not.toHaveProperty('title');
		expect(meal).toMatchObject({
			sourceRecipeId: recipe.id,
			title: 'Sunday soup',
			plannedYield: 6,
			sourceHtmlHash: 'sha256:complete',
			notes: 'Use the wide pot.'
		});
		expect(meal.applianceRequirements).toHaveLength(1);
		expect(meal.classifications).toHaveLength(1);
		expect(meal.media).toHaveLength(1);
		expect(meal.nutritionFacts).toHaveLength(1);
		expect(meal.instructions[0]?.id).not.toBe(recipe.instructions[0]?.id);
		expect(meal.instructionEvents[0]?.mealInstructionId).toBe(meal.instructions[0]?.id);

		const titles: string[] = [];
		const subscription = liveMealCalendarRange(database, 'org_family', {
			start: '2026-08-23',
			end: '2026-08-23'
		}).subscribe({ next: ({ meals }) => titles.push(meals[0]!.title) });
		try {
			await vi.waitFor(() => expect(titles).toEqual(['Sunday soup']));
			await editRecipe(database, recipe.id, at(22));
			await vi.waitFor(() => expect(titles.at(-1)).toBe('Changed soup'));
		} finally {
			subscription.unsubscribe();
		}
		expect(isRecipeFollowingMeal(await storedMeal(database, meal.id))).toBe(true);
	});

	test('a past meal shows the version in effect on its date, and a future one the latest', async () => {
		const database = await openDatabase();
		await joinHousehold(database);
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const past = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-21' });
		const upcoming = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-30'
		});

		await editRecipe(database, recipe.id, at(25));

		expect(await titleOf(database, past.id)).toBe('Sunday soup');
		expect(await titleOf(database, upcoming.id)).toBe('Changed soup');
		// Freezing is a read rule: the edit wrote nothing to either meal.
		expect(isRecipeFollowingMeal(await storedMeal(database, past.id))).toBe(true);
		expect(await database.outbox.filter(({ entityKind }) => entityKind === 'meal').count()).toBe(2);
	});

	test('devices with different clocks resolve a meal to the same version', async () => {
		const deviceA = await openDatabase();
		await joinHousehold(deviceA, 'Pacific/Auckland');
		const recipe = await commitImportedRecipeCandidate(deviceA, recipeContext(), completeRecipe());
		const friday = await planRecipeAsMeal(deviceA, mealContext(), recipe.id, {
			date: '2026-08-21'
		});
		const saturday = await planRecipeAsMeal(deviceA, mealContext(), recipe.id, {
			date: '2026-08-22'
		});
		// 13:00 UTC on Friday is already Saturday 01:00 in Auckland, so Friday's dinner was cooked
		// before this edit and Saturday's after it.
		await editRecipe(deviceA, recipe.id, '2026-08-21T13:00:00.000Z');
		const deviceB = await openDatabase();
		for (const store of ['households', 'recipeVersions', 'meals'] as const) {
			await deviceB.table(store).bulkPut(await deviceA.table(store).toArray());
		}

		const titlesAt = async (database: MaalDatabase, now: string) => {
			vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] });
			try {
				return [await titleOf(database, friday.id), await titleOf(database, saturday.id)];
			} finally {
				vi.useRealTimers();
			}
		};
		const expected = ['Sunday soup', 'Changed soup'];
		expect(await titlesAt(deviceA, '2026-08-21T14:00:00.000Z')).toEqual(expected);
		expect(await titlesAt(deviceB, '2031-01-01T00:00:00.000Z')).toEqual(expected);
	});

	test('the first edit copies the version it shows and detaches the meal from later edits', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23'
		});

		await updateMealHeader(database, mealContext(at(22)), meal.id, {
			title: 'Leftover soup',
			description: null,
			cookTimeMinutes: 20
		});
		const copied = await storedMeal(database, meal.id);
		expect(isRecipeFollowingMeal(copied)).toBe(false);
		// The copy keeps the row IDs the meal showed while it followed the recipe.
		expect(copied).toMatchObject({
			title: 'Leftover soup',
			sourceRecipeId: recipe.id,
			ingredients: meal.ingredients
		});
		const rows = await database.outbox.filter(({ occurredAt }) => occurredAt === at(22)).toArray();
		expect(rows.map(({ conflictGroup }) => conflictGroup)).toEqual(['source', 'header']);

		await editRecipe(database, recipe.id, at(23));
		expect(await titleOf(database, meal.id)).toBe('Leftover soup');
		expect((await listHouseholdMeals(database, 'org_family'))[0]?.ingredients).toHaveLength(1);
	});

	test('a check-in pins the version it was cooked with', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const [created] = await database.recipeVersions.toArray();
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-30'
		});

		const { checkIn } = await saveMealCheckIn(database, mealContext(at(22)), meal.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await editRecipe(database, recipe.id, at(23));

		expect(checkIn.recipeVersionId).toBe(created!.id);
		// Without the pin, the meal's date would show the edit.
		expect(await titleOf(database, meal.id)).toBe('Sunday soup');
		expect(isRecipeFollowingMeal(await storedMeal(database, meal.id))).toBe(true);
	});

	test('deleting or purging a recipe keeps every meal’s content', async () => {
		const database = await openDatabase();
		await joinHousehold(database);
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-30' });

		await deleteRecipe(database, recipeContext(at(22)), recipe.id);
		expect(await titleOf(database, meal.id)).toBe('Sunday soup');
		await permanentlyDeleteRecipe(database, recipeContext(at(23)), recipe.id);

		const shown = (await listHouseholdMeals(database, 'org_family'))[0]!;
		expect(shown).toMatchObject({ id: meal.id, sourceRecipeId: recipe.id, title: 'Sunday soup' });
		expect(shown.ingredients).toHaveLength(1);
		expect(isRecipeFollowingMeal(await storedMeal(database, meal.id))).toBe(true);
	});

	test('a meal planned before a deletion does not follow edits made after the restore', async () => {
		const database = await openDatabase();
		await joinHousehold(database);
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const before = await planRecipeAsMeal(database, mealContext(at(21)), recipe.id, {
			date: '2026-08-30'
		});

		await deleteRecipe(database, recipeContext(at(22)), recipe.id);
		await restoreRecipe(database, recipeContext(at(23)), recipe.id);
		const after = await planRecipeAsMeal(database, mealContext(at(24)), recipe.id, {
			date: '2026-08-30'
		});
		await editRecipe(database, recipe.id, at(25));

		expect(await titleOf(database, before.id)).toBe('Sunday soup');
		expect(await titleOf(database, after.id)).toBe('Changed soup');
	});

	test('device collection keeps every version a meal or check-in needs and drops the rest', async () => {
		const database = await openDatabase();
		await joinHousehold(database);
		await database.profiles.put({
			profileId: uuidv7(),
			workosUserId: 'user_alice',
			displayName: 'Alice',
			email: 'alice@example.test',
			profilePictureUrl: null,
			locale: 'en-NL',
			timezone: null,
			pinSalt: null,
			pinVerifier: null,
			lockPolicy: 'none',
			lastUsedAt: at(20),
			authState: 'authenticated'
		});
		const on = (date: string) => `${date}T10:00:00.000Z` as `${string}Z`;
		const recipe = await commitImportedRecipeCandidate(
			database,
			recipeContext(on('2026-01-01')),
			completeRecipe()
		);
		await editRecipe(database, recipe.id, on('2026-02-01'), 'February soup');
		const february = await planRecipeAsMeal(database, mealContext(on('2026-02-02')), recipe.id, {
			date: '2026-02-15'
		});
		await editRecipe(database, recipe.id, on('2026-03-01'), 'March soup');
		// Checked in early, so it pins March although its date falls after April's edit.
		const april = await planRecipeAsMeal(database, mealContext(on('2026-03-02')), recipe.id, {
			date: '2026-04-20'
		});
		await saveMealCheckIn(database, mealContext(on('2026-03-05')), april.id, {
			status: 'cooked',
			verdict: 'repeat'
		});
		await editRecipe(database, recipe.id, on('2026-04-01'), 'April soup');
		await editRecipe(database, recipe.id, on('2026-05-01'), 'May soup');
		await editRecipe(database, recipe.id, on('2026-08-01'), 'August soup');

		const removed = await runRecipeVersionRetention(database, new Date('2026-08-20T00:00:00Z'));

		const kept = (await database.recipeVersions.toArray())
			.map(({ recipe }) => (recipe as { title: string }).title)
			.toSorted();
		// January and April went; May stays because August took effect within 90 days.
		expect(removed).toHaveLength(2);
		expect(kept).toEqual(['August soup', 'February soup', 'March soup', 'May soup']);
		expect(await titleOf(database, february.id)).toBe('February soup');
		expect(await titleOf(database, april.id)).toBe('March soup');
		expect(await database.outbox.where('aggregateId').anyOf(removed).count()).toBe(0);
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
		expect(checkedIn.checkIn.recipeVersionId).not.toBeNull();
		expect(await database.outbox.count()).toBe(6);
		expect(
			(await database.outbox.filter(({ occurredAt }) => occurredAt === at(23)).toArray()).map(
				({ entityKind, aggregateId, conflictGroup }) => ({
					entityKind,
					aggregateId,
					conflictGroup
				})
			)
		).toEqual([
			{ entityKind: 'meal_check_in', aggregateId: checkedIn.checkIn.id, conflictGroup: 'response' },
			{ entityKind: 'meal', aggregateId: meal.id, conflictGroup: 'status' }
		]);

		await deleteMeal(database, mealContext(at(24)), meal.id);
		expect(await listHouseholdMeals(database, 'org_family')).toEqual([]);
		const historical = Schema.decodeUnknownSync(MealCheckInSchema)(
			await database.mealCheckIns.get(checkedIn.checkIn.id)
		);
		expect(historical.mealId).toBeNull();
		expect(historical.reason).toBe('Good enough for Tuesday.');
	});
});

describe('indexed calendar ranges', () => {
	test('live query ignores writes outside its compound date range', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const visibleMeal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			time: '18:30'
		});
		const historicalMeal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2020-01-01',
			time: '18:30'
		});
		const emissions: string[][] = [];
		const reads: number[] = [];
		const subscription = liveMealCalendarRange(
			database,
			'org_family',
			{ start: '2026-08-20', end: '2026-08-26' },
			(read) => reads.push(read.mealRowsRead)
		).subscribe(({ meals }) => emissions.push(meals.map(({ id }) => id)));
		await vi.waitFor(() => expect(emissions).toHaveLength(1));

		await updateMealSchedule(database, mealContext(at(22)), historicalMeal.id, {
			date: historicalMeal.date,
			time: '19:00',
			sortOrder: historicalMeal.sortOrder
		});
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(emissions).toHaveLength(1);

		await updateMealSchedule(database, mealContext(at(23)), visibleMeal.id, {
			date: visibleMeal.date,
			time: '19:00',
			sortOrder: visibleMeal.sortOrder
		});
		await vi.waitFor(() => expect(emissions).toHaveLength(2));
		expect(emissions[1]).toEqual([visibleMeal.id]);
		expect(reads).toEqual([1, 1]);
		subscription.unsubscribe();
	});

	// Seeds twelve years of history; this checks bounded reads, not a five-second budget.
	test('keeps reads bounded with twelve years of meals and check-ins', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const seedMeal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-03-29',
			time: '18:30'
		});
		const seedCheckIn = (
			await saveMealCheckIn(database, mealContext(at(23)), seedMeal.id, {
				status: 'cooked',
				verdict: 'repeat',
				cookTimeMinutes: 41,
				reason: 'Historical fixture.'
			})
		).checkIn;
		await database.meals.clear();
		await database.mealCheckIns.clear();

		const firstDay = Date.UTC(2020, 0, 1);
		const dayCount = 366 * 12;
		const dates = Array.from({ length: dayCount }, (_, offset) =>
			new Date(firstDay + offset * 86_400_000).toISOString().slice(0, 10)
		);
		const householdIds = ['org_family', 'org_other'] as const;
		const meals = householdIds.flatMap((householdId) =>
			dates.map((date) => ({
				...seedMeal,
				id: uuidv7(),
				householdId,
				date,
				title: `${householdId} ${date}`
			}))
		);
		const checkIns = meals.map((meal) => ({
			...seedCheckIn,
			id: uuidv7(),
			mealId: meal.id,
			reason: meal.date
		}));
		await database.transaction('rw', database.meals, database.mealCheckIns, async () => {
			await database.meals.bulkPut(meals);
			await database.mealCheckIns.bulkPut(checkIns);
		});

		const mealWhere = vi.spyOn(database.meals, 'where');
		const mealFullScan = vi.spyOn(database.meals, 'toArray');
		const checkInWhere = vi.spyOn(database.mealCheckIns, 'where');
		const checkInFullScan = vi.spyOn(database.mealCheckIns, 'toArray');
		const reads: Parameters<NonNullable<Parameters<typeof readMealCalendarRange>[3]>>[0][] = [];
		const result = await readMealCalendarRange(
			database,
			'org_family',
			{ start: '2026-03-28', end: '2026-03-30' },
			(read) => reads.push(read)
		);

		expect(result.meals.map(({ date }) => date)).toEqual([
			'2026-03-28',
			'2026-03-29',
			'2026-03-30'
		]);
		expect(result.checkIns.map(({ reason }) => reason).toSorted()).toEqual([
			'2026-03-28',
			'2026-03-29',
			'2026-03-30'
		]);
		expect(reads).toEqual([
			{
				householdId: 'org_family',
				start: '2026-03-28',
				end: '2026-03-30',
				mealIndex: '[householdId+date]',
				mealRowsRead: 3,
				checkInIndex: 'mealId',
				checkInRowsRead: 3
			}
		]);
		expect(mealWhere).toHaveBeenCalledWith('[householdId+date]');
		expect(checkInWhere).toHaveBeenCalledWith('mealId');
		expect(mealFullScan).not.toHaveBeenCalled();
		expect(checkInFullScan).not.toHaveBeenCalled();
	}, 30_000);

	test('returns an empty range without touching the check-in index', async () => {
		const database = await openDatabase();
		const checkInWhere = vi.spyOn(database.mealCheckIns, 'where');
		const result = await readMealCalendarRange(database, 'org_family', {
			start: '2026-08-20',
			end: '2026-08-21'
		});
		expect(result).toEqual({ meals: [], checkIns: [] });
		expect(checkInWhere).not.toHaveBeenCalled();
	});
});

describe('household meal pool', () => {
	test('lists every member’s undated live meals and reacts when a meal moves to the pool', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const plan = (context: MealCommandContext, date: string | null) =>
			planRecipeAsMeal(database, context, recipe.id, { date });
		const alicePool = await plan(mealContext(), null);
		const bobPool = await plan({ ...mealContext(), reporterUserId: 'user_bob' }, null);
		const scheduled = await plan(mealContext(), '2026-08-23');
		const deleted = await plan(mealContext(), null);
		await deleteMeal(database, mealContext(at(22)), deleted.id);
		await plan({ ...mealContext(), householdId: 'org_other' }, null);

		const emissions: string[][] = [];
		const subscription = liveMealPool(database, 'org_family').subscribe(({ meals }) =>
			emissions.push(meals.map(({ id }) => id).toSorted())
		);
		await vi.waitFor(() => expect(emissions).toHaveLength(1));
		expect(emissions[0]).toEqual([alicePool.id, bobPool.id].toSorted());

		await updateMealSchedule(database, mealContext(at(23)), scheduled.id, {
			date: null,
			time: null,
			sortOrder: 1000
		});
		await vi.waitFor(() => expect(emissions).toHaveLength(2));
		expect(emissions[1]).toEqual([alicePool.id, bobPool.id, scheduled.id].toSorted());
		expect((await readMealPool(database, 'org_family')).meals).toHaveLength(3);
		subscription.unsubscribe();
	});
});

describe('atomic meal reorder', () => {
	test('commits every move of one gesture together or not at all', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const first = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			sortOrder: 1
		});
		const second = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			sortOrder: 2
		});

		const reordered = await reorderMeals(database, mealContext(at(23)), [
			{ mealId: first.id, patch: { date: '2026-08-23', time: null, sortOrder: 2 } },
			{ mealId: second.id, patch: { date: '2026-08-23', time: null, sortOrder: 1 } }
		]);
		expect(reordered.map(({ sortOrder }) => sortOrder)).toEqual([2, 1]);

		// The second move names a meal that does not exist: no sort order or outbox row survives.
		const outboxBefore = await database.outbox.count();
		await expect(
			reorderMeals(database, mealContext(at(24)), [
				{ mealId: first.id, patch: { date: '2026-08-24', time: null, sortOrder: 1 } },
				{ mealId: uuidv7(), patch: { date: '2026-08-24', time: null, sortOrder: 2 } }
			])
		).rejects.toThrow();
		expect(await database.meals.get(first.id)).toMatchObject({
			date: '2026-08-23',
			sortOrder: 2
		});
		expect(await database.outbox.count()).toBe(outboxBefore);
	});
});

describe('meal sheet edits', () => {
	test('rolls back header edits and outbox rows when the schedule write fails', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			time: '18:30'
		});
		const originalMeal = await database.meals.get(meal.id);
		const originalOutbox = await database.outbox.toArray();
		const headerCommands = await mealHeaderCommands(database, mealContext(at(24)), meal.id, {
			title: 'Leftover soup',
			description: null,
			cookTimeMinutes: 20
		});
		const failSchedule = (changes: unknown) => {
			if (
				typeof changes === 'object' &&
				changes !== null &&
				'date' in changes &&
				changes.date === '2026-08-25'
			) {
				throw new DOMException('Storage is full', 'QuotaExceededError');
			}
		};
		database.meals.hook('updating', failSchedule);

		try {
			await expect(
				executeLocalCommands(database, [
					...headerCommands,
					mealScheduleCommand(mealContext(at(24)), meal.id, {
						date: '2026-08-25',
						time: '19:00',
						sortOrder: null
					})
				])
			).rejects.toMatchObject({ _tag: 'LocalQuotaExceededError' });
		} finally {
			database.meals.hook('updating').unsubscribe(failSchedule);
		}

		expect(await database.meals.get(meal.id)).toEqual(originalMeal);
		expect(await database.outbox.toArray()).toEqual(originalOutbox);
	});

	test('copies a recipe-following meal, then saves its header with its own outbox row and clock', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, {
			date: '2026-08-23',
			time: '18:30'
		});

		const renamed = await updateMealHeader(database, mealContext(at(24)), meal.id, {
			title: '  Leftover soup  ',
			description: '   ',
			cookTimeMinutes: 20
		});

		expect(renamed).toMatchObject({
			title: 'Leftover soup',
			description: null,
			cookTimeMinutes: 20,
			date: '2026-08-23',
			time: '18:30'
		});
		expect(renamed.conflictClocks.header?.occurredAt).toBe(at(24));
		expect((await listHouseholdMeals(database, 'org_family'))[0]?.title).toBe('Leftover soup');
		const rows = await database.outbox.filter(({ occurredAt }) => occurredAt === at(24)).toArray();
		expect(
			rows.map(({ entityKind, aggregateId, conflictGroup }) => [
				entityKind,
				aggregateId,
				conflictGroup
			])
		).toEqual([
			['meal', meal.id, 'source'],
			['meal', meal.id, 'header']
		]);
	});

	test('maps a check-in without inventing familiarity or an adjusted cook time', async () => {
		const database = await openDatabase();
		const recipe = await commitImportedRecipeCandidate(database, recipeContext(), completeRecipe());
		const meal = await planRecipeAsMeal(database, mealContext(), recipe.id, { date: '2026-08-23' });
		const { meal: cooked, checkIn } = await saveMealCheckIn(
			database,
			mealContext(at(23)),
			meal.id,
			{
				status: 'cooked',
				verdict: 'avoid',
				cookTimeMinutes: 55,
				reason: 'Too spicy.'
			}
		);

		const scheduled = mealAggregateToScheduleMeal(cooked, checkIn);

		expect(scheduled).not.toHaveProperty('familiarity');
		expect(scheduled).not.toHaveProperty('adjustedCookTimeMinutes');
		expect(scheduled.cookTimeMinutes).toBe(33);
		expect(scheduled.latestCheckIn).toEqual({
			verdict: 'avoid',
			cookTime: 55,
			reason: 'Too spicy.'
		});
	});

	test('offers only active members as cooks, named from local profiles or attributions', () => {
		const membership = (workosUserId: string, status: Membership['status']): Membership => ({
			membershipId: `membership_${workosUserId}`,
			householdId: 'org_family',
			workosUserId,
			roleSlug: 'member',
			permissions: [],
			status,
			directoryManaged: false,
			workosCreatedAt: at(20),
			lastVerifiedAt: at(20),
			updatedAt: at(20),
			detachedAt: status === 'active' ? null : at(21),
			denialCode: null,
			source: 'workos'
		});

		const members = membershipsToHouseholdMembers(
			[
				membership('user_alice', 'active'),
				membership('user_bob', 'active'),
				membership('user_carol', 'detached'),
				membership('user_dan', 'revoked')
			],
			[],
			[
				{
					workosUserId: 'user_bob',
					displayName: 'Bob de Vries',
					email: 'bob@example.test',
					profilePictureUrl: null
				}
			]
		);

		expect(members.map(({ userId, name, email }) => [userId, name, email])).toEqual([
			['user_alice', 'user_alice', ''],
			['user_bob', 'Bob de Vries', 'bob@example.test']
		]);
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
