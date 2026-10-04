import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { MaalDatabase, openMaalDatabase } from '$lib/client/local/database.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import type { MealCommandContext } from '$lib/client/meals/commands.js';
import {
	commitImportedCandidateAndPlanMeal,
	createRecipeFromEditor,
	type RecipeCommandContext
} from '$lib/client/recipes/commands.js';
import {
	RecipeUrlImportError,
	confirmUrlImport,
	fetchRecipeUrlCandidate
} from '$lib/client/recipes/url-import.js';
import {
	RecipeImportedCandidateSchema,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';
import { importedCandidateToMenuItem } from '$lib/menu/recipe-local-adapter.js';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

const HOUSEHOLD_ID = 'org_family';
const AUTH_SLOT_ID = 'slot-alice';
const USER_ID = 'user_alice';
const IMPORTED_AT = '2026-09-20T10:00:00.000Z';

const databases: MaalDatabase[] = [];

beforeAll(() => overwriteGetLocale(() => 'en'));

afterEach(async () => {
	for (const database of databases) {
		database.close();
		await Dexie.delete(database.name);
	}
	databases.length = 0;
});

const seededDatabase = async (
	options: { paid?: boolean; permissions?: ('meals:read' | 'meals:write')[] } = {}
): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`url-import-${crypto.randomUUID()}`);
	databases.push(database);
	const profileId = uuidv7();
	await database.uiState.put({ key: 'activeProfileId', value: profileId });
	await database.uiState.put({ key: activeHouseholdKey(profileId), value: HOUSEHOLD_ID });
	await database.authSlots.put({
		authSlotId: AUTH_SLOT_ID,
		profileId,
		workosUserId: USER_ID,
		sessionState: 'authenticated',
		lastRefreshedAt: IMPORTED_AT,
		lastVerifiedAt: IMPORTED_AT,
		nextRetryAt: null,
		retryCount: 0
	});
	await database.memberships.put({
		membershipId: 'membership_alice',
		householdId: HOUSEHOLD_ID,
		workosUserId: USER_ID,
		roleSlug: 'member',
		permissions: options.permissions ?? ['meals:read', 'meals:write'],
		status: 'active',
		directoryManaged: false,
		workosCreatedAt: IMPORTED_AT,
		lastVerifiedAt: IMPORTED_AT,
		updatedAt: IMPORTED_AT,
		source: 'workos',
		detachedAt: null,
		denialCode: null
	});
	if (options.paid ?? true) {
		await database.billingCapabilities.put({
			householdId: HOUSEHOLD_ID,
			state: 'enabled',
			stripeStatus: 'active',
			subscriberUserId: USER_ID,
			stripePriceId: 'price_test',
			currentPeriodEnd: '2099-01-01T00:00:00.000Z',
			interruptionStartedAt: null,
			graceUntil: null,
			validUntil: '2099-01-01T00:00:00.000Z',
			cancelAtPeriodEnd: false,
			stale: false,
			source: 'stripe-d1'
		});
	}
	return database;
};

const candidate = (): RecipeImportedCandidate =>
	Schema.decodeUnknownSync(RecipeImportedCandidateSchema)({
		savedFromHouseholdId: null,
		title: 'Tomato soup',
		description: 'Silky soup',
		imageUrl: null,
		prepTimeMinutes: 8,
		cookTimeMinutes: 35,
		totalTimeMinutes: 43,
		yield: 4,
		sourceYieldText: 'Serves four',
		sourceClaimedMinutes: 45,
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: 'en',
		sourceUrl: 'https://example.com/soup',
		sourceSiteName: 'Example Kitchen',
		sourceAuthorName: null,
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		sourceImportedAt: IMPORTED_AT,
		sourceHtmlHash: 'sha256:soup',
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		parseConfidence: 0.9,
		ingredientConfidence: 0.8,
		instructionConfidence: 0.7,
		nutritionConfidence: null,
		userNotes: null,
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
				createdAt: IMPORTED_AT
			}
		],
		instructions: [
			{
				id: uuidv7(),
				stepIndex: 0,
				sectionName: null,
				text: 'Simmer for 20 minutes.',
				durationMinutes: 20,
				confidence: 0.88,
				createdAt: IMPORTED_AT,
				updatedAt: IMPORTED_AT
			}
		],
		instructionEvents: [],
		applianceRequirements: [],
		classifications: [],
		media: [],
		nutritionFacts: []
	});

const respondWith = (status: number, body: unknown) =>
	vi.fn<typeof fetch>(async () => Response.json(body, { status }));

const failureReason = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error: unknown) => (error instanceof RecipeUrlImportError ? error.reason : error)
	);

const context = (): RecipeCommandContext => ({
	authSlotId: AUTH_SLOT_ID,
	ownerUserId: USER_ID,
	originDeviceId: uuidv7()
});

describe('fetchRecipeUrlCandidate', () => {
	test('posts the URL for the active slot and household and decodes the versioned candidate', async () => {
		const database = await seededDatabase();
		const imported = candidate();
		const fetcher = respondWith(200, {
			schemaVersion: 1,
			candidate: Schema.encodeSync(RecipeImportedCandidateSchema)(imported)
		});

		await expect(
			fetchRecipeUrlCandidate(database, 'https://example.com/soup', fetcher)
		).resolves.toEqual(imported);
		expect(fetcher).toHaveBeenCalledWith(`/api/auth-slots/${AUTH_SLOT_ID}/recipes/import-url`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ householdId: HOUSEHOLD_ID, url: 'https://example.com/soup' })
		});
	});

	test.each<[string, Parameters<typeof seededDatabase>[0], string]>([
		['free household', { paid: false }, 'plan_required'],
		['read-only member', { permissions: ['meals:read'] }, 'permission_denied']
	])('rejects a %s locally without a request', async (_, options, reason) => {
		const database = await seededDatabase(options);
		const fetcher = respondWith(200, {});

		expect(await failureReason(fetchRecipeUrlCandidate(database, 'https://x.test', fetcher))).toBe(
			reason
		);
		expect(fetcher).not.toHaveBeenCalled();
	});

	test.each([
		[401, 'SyncUnauthenticated', 'sign_in_required'],
		[403, 'SyncCapabilityDenied', 'plan_required'],
		[403, 'SyncPermissionDenied', 'permission_denied'],
		[429, 'RemoteComputeRateLimited', 'rate_limited'],
		[400, 'RecipeImportFetchError', 'page_unreachable'],
		[400, 'RecipeImportParseError', 'recipe_not_found'],
		[503, 'remote_compute_unavailable', 'unavailable']
	])('maps a %i %s response to %s', async (status, tag, reason) => {
		const database = await seededDatabase();
		expect(
			await failureReason(
				fetchRecipeUrlCandidate(database, 'https://x.test', respondWith(status, { error: tag }))
			)
		).toBe(reason);
	});

	test('treats a malformed candidate as unavailable', async () => {
		const database = await seededDatabase();
		expect(
			await failureReason(
				fetchRecipeUrlCandidate(
					database,
					'https://x.test',
					respondWith(200, { schemaVersion: 2, candidate: {} })
				)
			)
		).toBe('unavailable');
	});
});

describe('confirmUrlImport', () => {
	test('saving an imported draft commits the candidate to Dexie with an outbox row', async () => {
		const database = await seededDatabase();
		const imported = candidate();
		const draft = importedCandidateToMenuItem(imported, 'draft-recipe-1');

		const recipe = await confirmUrlImport(database, context(), imported, {
			...draft,
			title: 'Weeknight tomato soup'
		});

		expect(await database.recipes.count()).toBe(1);
		expect(await database.recipes.get(recipe.id)).toMatchObject({
			title: 'Weeknight tomato soup',
			sourceHtmlHash: 'sha256:soup',
			ownerUserId: USER_ID
		});
		const outbox = await database.outbox.toArray();
		expect(outbox).toHaveLength(1);
		expect(outbox[0]).toMatchObject({ entityKind: 'recipe', aggregateId: recipe.id });
	});

	test('importing into an existing recipe updates it instead of creating a second one', async () => {
		const database = await seededDatabase();
		const existing = await createRecipeFromEditor(database, context(), {
			title: 'Old soup',
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
			ingredients: [],
			instructions: []
		});
		const imported = candidate();

		const recipe = await confirmUrlImport(database, context(), imported, {
			...importedCandidateToMenuItem(imported, existing.id),
			id: existing.id
		});

		expect(recipe.id).toBe(existing.id);
		expect(await database.recipes.count()).toBe(1);
		expect(await database.recipes.get(existing.id)).toMatchObject({
			title: 'Tomato soup',
			sourceUrl: 'https://example.com/soup',
			ingredients: [expect.objectContaining({ sourceFoodLabel: 'tomatoes' })]
		});
	});
});

describe('commitImportedCandidateAndPlanMeal', () => {
	const mealContext = (): MealCommandContext => ({
		authSlotId: AUTH_SLOT_ID,
		householdId: HOUSEHOLD_ID,
		reporterUserId: USER_ID,
		originDeviceId: uuidv7()
	});

	test('commits the recipe and plans its meal in one gesture', async () => {
		const database = await seededDatabase();

		const { recipe, meal } = await commitImportedCandidateAndPlanMeal(
			database,
			mealContext(),
			candidate(),
			{ date: '2026-09-21', plannedYield: 4 }
		);

		expect(await database.recipes.get(recipe.id)).toMatchObject({ title: 'Tomato soup' });
		expect(meal).toMatchObject({
			sourceRecipeId: recipe.id,
			title: 'Tomato soup',
			date: '2026-09-21',
			plannedYield: 4
		});
		expect(
			(await database.outbox.toArray()).map(({ scopeKind, scopeId, entityKind }) => ({
				scopeKind,
				scopeId,
				entityKind
			}))
		).toEqual([
			{ scopeKind: 'user', scopeId: USER_ID, entityKind: 'recipe' },
			{ scopeKind: 'household', scopeId: HOUSEHOLD_ID, entityKind: 'meal' }
		]);
	});

	test('leaves no recipe behind when planning the meal fails', async () => {
		const database = await seededDatabase();
		const fail = () => {
			throw new Error('meal write failed');
		};
		database.meals.hook('creating', fail);

		await expect(
			commitImportedCandidateAndPlanMeal(database, mealContext(), candidate(), {
				date: '2026-09-21'
			})
		).rejects.toBeTruthy();

		expect(await database.recipes.count()).toBe(0);
		expect(await database.outbox.count()).toBe(0);
	});
});
