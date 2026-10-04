import 'fake-indexeddb/auto';

import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import { exportDecodableRecoveryData } from '$lib/client/local/recovery.js';
import { exportRecoveryArchives } from '$lib/client/local/recovery-export.js';
import {
	bulkResolutions,
	commitPortableImport,
	createPortableArchiveBlob,
	decodePortableArchive,
	exportPortableArchive,
	planPortableImport,
	type PortableImportPlan
} from '$lib/client/portability/index.js';
import { applyUserPullPage } from '$lib/client/sync/apply.js';
import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import { UserFoodPreferenceSchema } from '$lib/domain/taxonomy/schema.js';
import {
	planRecipeAsMeal,
	saveMealCheckIn,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import {
	commitImportedRecipeCandidate,
	type RecipeCommandContext
} from '$lib/client/recipes/index.js';
import { subscribeLocalSyncRequests } from '$lib/client/sync/index.js';
import type { PortableArchive } from '$lib/domain/portability/schema.js';
import { MEAL_CONFLICT_GROUPS } from '$lib/domain/meals/schema.js';
import {
	RECIPE_CONFLICT_GROUPS,
	RecipeImportedCandidateSchema,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';

configure({ useWebWorkers: false });

const databases: MaalDatabase[] = [];
const at = (hour: number): `${string}Z` => `2026-08-21T${String(hour).padStart(2, '0')}:00:00.000Z`;
const deviceId = uuidv7();
const tomatoFoodId = uuidv7();

const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`portability-${crypto.randomUUID()}`);
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

const seedIdentity = async (
	database: MaalDatabase,
	options: { withHousehold: boolean; workosUserId?: string } = { withHousehold: true }
): Promise<{ profileId: string; workosUserId: string; householdId: string }> => {
	const profileId = uuidv7();
	const workosUserId = options.workosUserId ?? 'user_alice';
	const householdId = 'org_family';
	await database.profiles.put({
		profileId,
		workosUserId,
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: 'https://images.example/alice.jpg',
		locale: 'en-US',
		timezone: 'Europe/Amsterdam',
		pinSalt: 'never-export-this-salt',
		pinVerifier: 'never-export-this-verifier',
		lockPolicy: 'pin',
		lastUsedAt: at(9),
		authState: 'authenticated'
	});
	await database.uiState.put({ key: 'activeProfileId', value: profileId });
	if (options.withHousehold) {
		await database.households.put({
			householdId,
			name: 'Family kitchen',
			locale: 'en-US',
			timezone: 'Europe/Amsterdam',
			weekStartsOn: 1,
			defaultPlannedYield: 4,
			preferredDinnerTime: '18:00',
			createdByUserId: workosUserId,
			deletionState: 'active',
			localOnly: false,
			schemaVersion: 1,
			revision: 1,
			createdAt: at(8),
			updatedAt: at(8),
			deletedAt: null,
			conflictClocks: {}
		});
		await database.memberships.put({
			membershipId: `membership_${profileId}`,
			householdId,
			workosUserId,
			roleSlug: 'admin',
			permissions: [
				'households:write',
				'recipes:read',
				'recipes:write',
				'meals:read',
				'meals:write'
			],
			status: 'active',
			directoryManaged: false,
			workosCreatedAt: at(8),
			lastVerifiedAt: at(8),
			updatedAt: at(8),
			detachedAt: null,
			denialCode: null,
			source: 'workos'
		});
		await database.householdAppliances.put({
			id: uuidv7(),
			householdId,
			appliance: 'stovetop',
			available: true,
			notes: 'Induction',
			schemaVersion: 1,
			revision: 1,
			createdAt: at(8),
			updatedAt: at(8),
			deletedAt: null,
			conflictClocks: {}
		});
	}
	return { profileId, workosUserId, householdId };
};

const candidate = (title = 'Sunday soup'): RecipeImportedCandidate => {
	const instructionId = uuidv7();
	return Schema.decodeUnknownSync(RecipeImportedCandidateSchema)({
		savedFromHouseholdId: 'org_family',
		title,
		description: 'A complete local snapshot.',
		imageUrl: 'https://images.example/soup.jpg',
		prepTimeMinutes: 10,
		cookTimeMinutes: 30,
		totalTimeMinutes: 40,
		yield: 4,
		sourceYieldText: 'Serves four',
		sourceClaimedMinutes: 40,
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: 'en',
		sourceUrl: 'https://example.test/soup',
		sourceSiteName: 'Example',
		sourceAuthorName: null,
		sourcePublisherName: null,
		sourceIsBasedOnUrl: null,
		sourceImportedAt: at(9),
		sourceHtmlHash: null,
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		parseConfidence: 0.9,
		ingredientConfidence: 0.9,
		instructionConfidence: 0.9,
		nutritionConfidence: null,
		userNotes: null,
		ingredients: [
			{
				id: uuidv7(),
				lineIndex: 0,
				originalText: '1 cup water',
				sourceAmountText: '1',
				sourceQuantity: 1,
				sourceUnitLabel: 'cup',
				sourceFoodLabel: 'water',
				baseFoodId: null,
				baseQuantity: 236.5882365,
				baseUnitId: 'cups',
				baseUnitFamilyId: 'milliliters',
				optional: false,
				confidence: 0.9,
				createdAt: at(9)
			}
		],
		instructions: [
			{
				id: instructionId,
				stepIndex: 0,
				sectionName: null,
				text: 'Simmer gently.',
				durationMinutes: null,
				confidence: 0.9,
				createdAt: at(9),
				updatedAt: at(9)
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
				confidence: 0.9,
				createdAt: at(9)
			}
		],
		applianceRequirements: [],
		classifications: [],
		media: [],
		nutritionFacts: []
	});
};

const seedContent = async (database: MaalDatabase, recipeId = uuidv7()) => {
	const identity = await seedIdentity(database);
	const recipeContext: RecipeCommandContext = {
		authSlotId: 'slot-alice',
		ownerUserId: identity.workosUserId,
		originDeviceId: deviceId,
		occurredAt: at(10)
	};
	const recipe = await commitImportedRecipeCandidate(
		database,
		recipeContext,
		candidate(),
		recipeId
	);
	const mealContext: MealCommandContext = {
		authSlotId: 'slot-alice',
		householdId: identity.householdId,
		reporterUserId: identity.workosUserId,
		originDeviceId: deviceId,
		occurredAt: at(11)
	};
	const meal = await planRecipeAsMeal(database, mealContext, recipe.id, { date: '2026-08-22' });
	await saveMealCheckIn(database, { ...mealContext, occurredAt: at(12) }, meal.id, {
		status: 'cooked',
		verdict: 'repeat',
		cookTimeMinutes: 32,
		reason: 'Easy enough.'
	});
	await database.userFoodPreferences.put({
		id: uuidv7(),
		workosUserId: identity.workosUserId,
		foodId: tomatoFoodId,
		preference: 'like',
		reason: 'Good in soup',
		schemaVersion: 1,
		revision: 1,
		createdAt: at(10),
		updatedAt: at(10),
		deletedAt: null,
		conflictClocks: {}
	});
	await database.foodUserEntries.put({
		id: tomatoFoodId,
		workosUserId: identity.workosUserId,
		canonicalLabel: 'Tomato',
		defaultMeasureUnitId: null,
		defaultMeasureBaseUnitId: null,
		adoptionStatus: 'accepted',
		schemaVersion: 1,
		revision: 1,
		createdAt: at(10),
		updatedAt: at(10),
		deletedAt: null,
		conflictClocks: {}
	});
	return { ...identity, recipe, meal };
};

const forkPlan = (
	plan: PortableImportPlan,
	writes: PortableImportPlan['writes']
): PortableImportPlan => ({
	...plan,
	writes
});

describe('portable archives', () => {
	test('round-trips the visible graph without secrets and restores inaccessible households as local forks', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		await source.authSlots.put({
			authSlotId: uuidv7(),
			profileId: seeded.profileId,
			workosUserId: seeded.workosUserId,
			sessionState: 'authenticated',
			lastRefreshedAt: at(12),
			lastVerifiedAt: at(12),
			nextRetryAt: null,
			retryCount: 0
		});

		const blob = await exportPortableArchive(source, seeded.profileId, { createdAt: at(13) });
		const archive = await decodePortableArchive(blob);
		const encoded = JSON.stringify(archive);
		expect(encoded).not.toContain('conflictClocks');
		expect(encoded).not.toContain('pinVerifier');
		expect(encoded).not.toContain('never-export-this');
		expect(encoded).not.toContain('authSlotId');
		expect(archive.users.users[0]).toEqual({
			workosUserId: 'user_alice',
			displayName: 'Alice',
			profilePictureUrl: 'https://images.example/alice.jpg'
		});

		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target, { withHousehold: false });
		const plan = await planPortableImport(target, archive, targetIdentity.profileId);
		expect(plan.unresolvedCollisionIds).toEqual([]);
		expect(plan.warnings).toHaveLength(1);
		await commitPortableImport(target, plan);

		const restoredHousehold = await target.households.toCollection().first();
		expect(restoredHousehold).toMatchObject({ localOnly: true, createdByUserId: 'user_alice' });
		await expect(target.profiles.count()).resolves.toBe(1);
		await expect(target.userAttributions.get('user_alice')).resolves.toMatchObject({
			displayName: 'Alice'
		});
		const restoredRecipe = await target.recipes.toCollection().first();
		const restoredMeal = await target.meals.toCollection().first();
		const restoredCheckIn = await target.mealCheckIns.toCollection().first();
		expect(restoredRecipe?.ownerUserId).toBe('user_alice');
		expect(restoredMeal?.householdId).toBe(restoredHousehold?.householdId);
		expect(restoredMeal?.id).not.toBe(seeded.meal.id);
		expect(restoredCheckIn?.mealId).toBe(restoredMeal?.id);
		expect(Object.keys(restoredRecipe?.conflictClocks ?? {}).toSorted()).toEqual(
			[...RECIPE_CONFLICT_GROUPS].toSorted()
		);
		expect(Object.keys(restoredMeal?.conflictClocks ?? {}).toSorted()).toEqual(
			[...MEAL_CONFLICT_GROUPS].toSorted()
		);
		const instructions = restoredMeal?.instructions as { id: string }[];
		const events = restoredMeal?.instructionEvents as { mealInstructionId: string }[];
		expect(events[0]?.mealInstructionId).toBe(instructions[0]?.id);
	});

	test('never replaces the current bundled global taxonomy with archive seed rows', async () => {
		const source = await openDatabase();
		const sourceIdentity = await seedIdentity(source, { withHousehold: false });
		const archive = await decodePortableArchive(
			await exportPortableArchive(source, sourceIdentity.profileId, { createdAt: at(13) })
		);
		const archivedGram = archive.taxonomy.units.find(({ id }) => id === 'grams');
		expect(archivedGram).toBeDefined();
		(archivedGram as { toBaseFactor: number }).toBaseFactor = 999;

		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target, { withHousehold: false });
		const preview = await planPortableImport(target, archive, targetIdentity.profileId);
		const replaceAll = Object.fromEntries(
			preview.collisions.map(({ collisionId }) => [collisionId, 'replace' as const])
		);
		const plan = await planPortableImport(target, archive, targetIdentity.profileId, replaceAll);
		await commitPortableImport(target, plan);

		expect(plan.writes.get('units') ?? []).toEqual([]);
		await expect(target.units.get('grams')).resolves.toMatchObject({ toBaseFactor: 1 });
	});

	test('preflights primary and natural-key collisions and supports keep, replace, and copy', async () => {
		const recipeId = uuidv7();
		const source = await openDatabase();
		const seeded = await seedContent(source, recipeId);
		const archive = await decodePortableArchive(
			await exportPortableArchive(source, seeded.profileId, { createdAt: at(13) })
		);
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target);
		await commitImportedRecipeCandidate(
			target,
			{
				authSlotId: 'slot-target',
				ownerUserId: 'user_alice',
				originDeviceId: deviceId,
				occurredAt: at(14)
			},
			candidate('Different local soup'),
			recipeId
		);
		await target.userFoodPreferences.put({
			id: uuidv7(),
			workosUserId: 'user_alice',
			foodId: tomatoFoodId,
			preference: 'dislike',
			reason: null,
			schemaVersion: 1,
			revision: 1,
			createdAt: at(14),
			updatedAt: at(14),
			deletedAt: null,
			conflictClocks: {}
		});

		const preview = await planPortableImport(target, archive, targetIdentity.profileId);
		const recipeCollision = preview.collisions.find(({ store }) => store === 'recipes');
		const naturalCollision = preview.collisions.find(
			({ store }) => store === 'userFoodPreferences'
		);
		expect(recipeCollision).toMatchObject({
			kind: 'primary-id',
			allowedResolutions: ['keep-local', 'replace', 'import-as-copy']
		});
		expect(naturalCollision).toMatchObject({ kind: 'natural-key' });
		expect(preview.unresolvedCollisionIds.length).toBeGreaterThanOrEqual(2);
		const keepAll = Object.fromEntries(
			preview.collisions.map(({ collisionId }) => [collisionId, 'keep-local' as const])
		);

		const keepPlan = await planPortableImport(target, archive, targetIdentity.profileId, {
			...keepAll,
			[recipeCollision!.collisionId]: 'keep-local',
			[naturalCollision!.collisionId]: 'keep-local'
		});
		expect(keepPlan.writes.get('recipes') ?? []).toHaveLength(0);

		const replacePlan = await planPortableImport(target, archive, targetIdentity.profileId, {
			...keepAll,
			[recipeCollision!.collisionId]: 'replace',
			[naturalCollision!.collisionId]: 'replace'
		});
		expect(replacePlan.writes.get('recipes')?.[0]).toMatchObject({
			id: recipeId,
			title: 'Sunday soup'
		});

		const copyPlan = await planPortableImport(target, archive, targetIdentity.profileId, {
			...keepAll,
			[recipeCollision!.collisionId]: 'import-as-copy',
			[naturalCollision!.collisionId]: 'keep-local'
		});
		await commitPortableImport(target, copyPlan);
		await expect(target.recipes.count()).resolves.toBe(2);
		const copied = (await target.recipes.toArray()).find(({ id }) => id !== recipeId);
		expect(copied?.title).toBe('Sunday soup');
		const copiedInstructions = copied?.instructions as { id: string }[];
		const copiedEvents = copied?.instructionEvents as { recipeInstructionId: string }[];
		expect(copiedEvents[0]?.recipeInstructionId).toBe(copiedInstructions[0]?.id);
	});

	test('replaces a pulled natural-key match in place and queues its upsert under the profile slot', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await decodePortableArchive(
			await exportPortableArchive(source, seeded.profileId, { createdAt: at(13) })
		);
		const archived = archive.preferences.userFoodPreferences[0]!;
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target);
		await target.authSlots.put({
			authSlotId: 'slot-target',
			profileId: targetIdentity.profileId,
			workosUserId: 'user_alice',
			sessionState: 'authenticated',
			lastRefreshedAt: at(12),
			lastVerifiedAt: at(12),
			nextRetryAt: null,
			retryCount: 0
		});
		const localPreferenceId = uuidv7();
		await target.foodUserEntries.put({
			id: tomatoFoodId,
			workosUserId: 'user_alice',
			canonicalLabel: 'Tomato',
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null,
			adoptionStatus: 'accepted',
			schemaVersion: 1,
			revision: 1,
			createdAt: at(10),
			updatedAt: at(10),
			deletedAt: null,
			conflictClocks: {}
		});
		await target.userFoodPreferences.put({
			id: localPreferenceId,
			workosUserId: 'user_alice',
			foodId: tomatoFoodId,
			preference: 'dislike',
			reason: null,
			schemaVersion: 1,
			revision: 1,
			createdAt: at(10),
			updatedAt: at(10),
			deletedAt: null,
			conflictClocks: {}
		});
		await target.backfillCheckpoints.put({
			scopeKind: 'user',
			scopeId: 'user_alice',
			entityKind: 'userFoodPreference',
			priorityBoundary: null,
			lastAggregateId: localPreferenceId,
			processedCount: 1,
			state: 'complete'
		});

		const preview = await planPortableImport(target, archive, targetIdentity.profileId);
		const natural = preview.collisions.find(
			({ store, kind }) => store === 'userFoodPreferences' && kind === 'natural-key'
		)!;
		const resolutions = Object.fromEntries(
			preview.collisions.map(({ collisionId }) => [
				collisionId,
				collisionId === natural.collisionId ? ('replace' as const) : ('keep-local' as const)
			])
		);
		const plan = await planPortableImport(target, archive, targetIdentity.profileId, resolutions);
		const syncEvents: unknown[] = [];
		const unsubscribe = subscribeLocalSyncRequests((event) => syncEvents.push(event));
		await commitPortableImport(target, plan);
		unsubscribe();

		// D1 keeps one row per natural key, so the archive content takes over the local ID
		// instead of a delete plus an insert that the server could apply out of order.
		await expect(target.userFoodPreferences.toArray()).resolves.toEqual([
			expect.objectContaining({
				id: localPreferenceId,
				preference: 'like',
				reason: 'Good in soup',
				updatedAt: archived.updatedAt
			})
		]);
		const outbox = await target.outbox.where('aggregateId').equals(localPreferenceId).toArray();
		expect(outbox).toEqual([
			expect.objectContaining({
				authSlotId: 'slot-target',
				scopeKind: 'user',
				scopeId: 'user_alice',
				entityKind: 'userFoodPreference',
				operation: 'upsert',
				status: 'pending',
				occurredAt: expect.any(String)
			})
		]);
		expect(Date.parse(outbox[0]!.occurredAt)).toBeGreaterThan(Date.parse(archived.updatedAt));
		await expect(target.userFoodPreferences.get(localPreferenceId)).resolves.toMatchObject({
			conflictClocks: { row: { occurredAt: outbox[0]!.occurredAt } }
		});
		const replanned = await planPortableImport(target, archive, targetIdentity.profileId);
		expect(replanned.collisions.filter(({ store }) => store === 'userFoodPreferences')).toEqual([]);
		await expect(
			target.backfillCheckpoints.get(['user', 'user_alice', 'userFoodPreference'])
		).resolves.toBeUndefined();
		expect(syncEvents).toEqual([
			expect.objectContaining({
				databaseName: target.name,
				scopes: expect.arrayContaining([{ scopeKind: 'user', scopeId: 'user_alice' }])
			})
		]);
	});

	test('gives an active-household copy a fresh local admin membership', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await decodePortableArchive(
			await exportPortableArchive(source, seeded.profileId, { createdAt: at(13) })
		);
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target);
		await target.households.update(targetIdentity.householdId, { name: 'Different local kitchen' });

		const preview = await planPortableImport(target, archive, targetIdentity.profileId);
		const householdCollision = preview.collisions.find(({ store }) => store === 'households');
		expect(householdCollision).toMatchObject({ kind: 'primary-id' });
		const resolutions = Object.fromEntries(
			preview.collisions.map(({ collisionId }) => [collisionId, 'keep-local' as const])
		);
		const copyPlan = await planPortableImport(target, archive, targetIdentity.profileId, {
			...resolutions,
			[householdCollision!.collisionId]: 'import-as-copy'
		});
		await commitPortableImport(target, copyPlan);

		const copiedHousehold = (await target.households.toArray()).find(
			({ householdId }) => householdId !== targetIdentity.householdId
		);
		expect(copiedHousehold).toMatchObject({
			localOnly: true,
			deletionState: 'active',
			createdByUserId: 'user_alice'
		});
		await expect(
			target.memberships
				.where('[householdId+status]')
				.equals([copiedHousehold!.householdId, 'active'])
				.first()
		).resolves.toMatchObject({
			workosUserId: 'user_alice',
			roleSlug: 'admin',
			source: 'localFork'
		});
	});

	test('remaps custom taxonomy dependencies before aliases and display preferences', async () => {
		const source = await openDatabase();
		const seeded = await seedIdentity(source, { withHousehold: false });
		const unitId = uuidv7();
		const foodId = uuidv7();
		const foodAliasId = uuidv7();
		const metadata = {
			schemaVersion: 1 as const,
			revision: 1,
			createdAt: at(10),
			updatedAt: at(10),
			deletedAt: null,
			conflictClocks: {}
		};
		await source.unitUserEntries.put({
			...metadata,
			id: unitId,
			workosUserId: seeded.workosUserId,
			canonicalLabel: 'pinch',
			baseUnitId: 'grams',
			toBaseFactor: 0.25,
			toBaseOffset: 0,
			adoptionStatus: 'accepted'
		});
		await source.foodUserEntries.put({
			...metadata,
			id: foodId,
			workosUserId: seeded.workosUserId,
			canonicalLabel: 'spice mix',
			defaultMeasureUnitId: unitId,
			defaultMeasureBaseUnitId: 'grams',
			adoptionStatus: 'accepted'
		});
		await source.foodUserAliases.put({
			...metadata,
			id: foodAliasId,
			workosUserId: seeded.workosUserId,
			foodId,
			alias: 'house spice',
			locale: 'en-US',
			sourceDomain: null,
			adoptionStatus: 'accepted',
			defaultMeasureUnitId: unitId,
			defaultMeasureBaseUnitId: 'grams'
		});
		await source.userFoodDisplayPreferences.put({
			...metadata,
			id: uuidv7(),
			workosUserId: seeded.workosUserId,
			foodId,
			locale: 'en-US',
			preferredFoodAliasScope: 'user',
			preferredFoodAliasId: foodAliasId,
			preferredMeasureUnitId: unitId,
			preferredMeasureBaseUnitId: 'grams'
		});

		const archive = await decodePortableArchive(
			await exportPortableArchive(source, seeded.profileId, { createdAt: at(13) })
		);
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target, {
			withHousehold: false,
			workosUserId: 'user_bob'
		});
		const plan = await planPortableImport(target, archive, targetIdentity.profileId);
		expect(plan.unresolvedCollisionIds).toEqual([]);
		await commitPortableImport(target, plan);

		const importedUnit = await target.unitUserEntries
			.where('workosUserId')
			.equals('user_bob')
			.first();
		const importedFood = await target.foodUserEntries
			.where('workosUserId')
			.equals('user_bob')
			.first();
		const importedAlias = await target.foodUserAliases
			.where('workosUserId')
			.equals('user_bob')
			.first();
		const importedPreference = await target.userFoodDisplayPreferences
			.where('workosUserId')
			.equals('user_bob')
			.first();
		expect(importedUnit?.id).not.toBe(unitId);
		expect(importedFood).toMatchObject({ defaultMeasureUnitId: importedUnit?.id });
		expect(importedAlias).toMatchObject({
			foodId: importedFood?.id,
			defaultMeasureUnitId: importedUnit?.id
		});
		expect(importedPreference).toMatchObject({
			foodId: importedFood?.id,
			preferredFoodAliasId: importedAlias?.id,
			preferredMeasureUnitId: importedUnit?.id,
			preferredMeasureBaseUnitId: 'grams'
		});
	});

	test('rejects corrupt, unknown-path, and future-version archives', async () => {
		await expect(decodePortableArchive(new Blob(['not a zip']))).rejects.toMatchObject({
			code: 'invalid_zip'
		});

		const pathWriter = new ZipWriter(new BlobWriter('application/zip'));
		await pathWriter.add('../manifest.json', new TextReader('{}'));
		await expect(decodePortableArchive(await pathWriter.close())).rejects.toMatchObject({
			code: 'invalid_zip'
		});

		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await decodePortableArchive(
			await exportPortableArchive(source, seeded.profileId)
		);
		const future = structuredClone(archive);
		(future.manifest as { archiveFormatVersion: number }).archiveFormatVersion = 999;
		await expect(
			decodePortableArchive(await createPortableArchiveBlob(future as PortableArchive))
		).rejects.toMatchObject({ code: 'unsupported_version' });
	});

	test('rolls every store back when a compound uniqueness write fails', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await decodePortableArchive(
			await exportPortableArchive(source, seeded.profileId)
		);
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target, { withHousehold: false });
		const plan = await planPortableImport(target, archive, targetIdentity.profileId);
		const writes = new Map(plan.writes);
		const appliance = writes.get('householdAppliances')?.[0];
		expect(appliance).toBeDefined();
		writes.set('householdAppliances', [appliance!, { ...appliance!, id: uuidv7() }]);

		await expect(commitPortableImport(target, forkPlan(plan, writes))).rejects.toMatchObject({
			code: 'commit_failed'
		});
		await expect(target.households.count()).resolves.toBe(0);
		await expect(target.recipes.count()).resolves.toBe(0);
	});
});

describe('portable imports and sync', () => {
	const ownArchive = async (database: MaalDatabase, profileId: string) =>
		decodePortableArchive(await exportPortableArchive(database, profileId, { createdAt: at(13) }));

	const keepAll = (plan: PortableImportPlan) => bulkResolutions(plan.collisions, 'keep-local');

	test('a replaced row survives the next pull because it has a pending upsert', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await ownArchive(source, seeded.profileId);
		const archived = archive.preferences.userFoodPreferences[0]!;
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target);
		await target.foodUserEntries.put({
			...archive.taxonomy.foodUserEntries[0]!,
			conflictClocks: {}
		});
		const local = { ...archived, preference: 'dislike' as const, revision: 3, conflictClocks: {} };
		await target.userFoodPreferences.put(local);

		const preview = await planPortableImport(target, archive, targetIdentity.profileId);
		const collision = preview.collisions.find(({ store }) => store === 'userFoodPreferences')!;
		await commitPortableImport(
			target,
			await planPortableImport(target, archive, targetIdentity.profileId, {
				...keepAll(preview),
				[collision.collisionId]: 'replace'
			})
		);
		await expect(target.outbox.where('aggregateId').equals(archived.id).toArray()).resolves.toEqual(
			[
				expect.objectContaining({
					operation: 'upsert',
					status: 'pending',
					occurredAt: expect.any(String)
				})
			]
		);

		const remoteClock = { occurredAt: at(11), originDeviceId: uuidv7(), mutationId: uuidv7() };
		await applyUserPullPage(target, 'user_alice', {
			protocolVersion: CURRENT_PROTOCOL_VERSION,
			changes: [
				{
					sequence: 1,
					mutationId: remoteClock.mutationId,
					originDeviceId: remoteClock.originDeviceId,
					entityKind: 'userFoodPreference',
					entityId: archived.id,
					conflictGroups: ['row'],
					operation: 'upsert',
					resultingRevision: 4,
					occurredAt: at(11),
					receivedAt: at(11),
					aggregate: Schema.encodeSync(UserFoodPreferenceSchema)({
						...local,
						revision: 4,
						conflictClocks: { row: remoteClock }
					}),
					tombstoneExpiresAt: null
				}
			],
			throughSequence: 1,
			retainedFloor: 0,
			bootstrapGeneration: 1,
			hasMore: false
		});
		await expect(target.userFoodPreferences.get(archived.id)).resolves.toMatchObject({
			preference: 'like'
		});
	});

	test('imported rows keep their archive timestamps, so importing again changes nothing', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await ownArchive(source, seeded.profileId);
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target);
		const first = await planPortableImport(target, archive, targetIdentity.profileId);
		await commitPortableImport(
			target,
			await planPortableImport(target, archive, targetIdentity.profileId, keepAll(first))
		);

		await expect(target.recipes.get(seeded.recipe.id)).resolves.toMatchObject({
			updatedAt: archive.recipes.recipes[0]!.updatedAt,
			conflictClocks: expect.objectContaining({
				header: expect.objectContaining({ occurredAt: archive.recipes.recipes[0]!.updatedAt })
			})
		});
		const second = await planPortableImport(target, archive, targetIdentity.profileId);
		expect(second.collisions).toEqual([]);
		expect(second.summary).toEqual({ userAttributions: 1 });
	});

	test('copying a household leaves recipes saved from the original household alone', async () => {
		const db = await openDatabase();
		const seeded = await seedContent(db);
		const archive = await ownArchive(db, seeded.profileId);
		await db.households.update(seeded.householdId, { name: 'Renamed locally' });
		const preview = await planPortableImport(db, archive, seeded.profileId);
		const household = preview.collisions.find(({ store }) => store === 'households')!;

		const plan = await planPortableImport(db, archive, seeded.profileId, {
			[household.collisionId]: 'import-as-copy'
		});
		expect(plan.collisions.map(({ store }) => store)).toEqual(['households']);
	});

	test('a non-member restore does not point synced recipes at its local-only household', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await ownArchive(source, seeded.profileId);
		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target, { withHousehold: false });
		await commitPortableImport(
			target,
			await planPortableImport(target, archive, targetIdentity.profileId)
		);

		await expect(target.recipes.get(seeded.recipe.id)).resolves.toMatchObject({
			savedFromHouseholdId: null
		});
	});

	test('meal provenance to a recipe that is not on this device survives export and import', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const otherMembersRecipeId = uuidv7();
		await source.meals.update(seeded.meal.id, { sourceRecipeId: otherMembersRecipeId });
		const archive = await ownArchive(source, seeded.profileId);
		expect(archive.meals.meals[0]?.sourceRecipeId).toBe(otherMembersRecipeId);

		const replanned = await planPortableImport(source, archive, seeded.profileId);
		expect(replanned.collisions).toEqual([]);

		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target);
		const plan = await planPortableImport(target, archive, targetIdentity.profileId);
		await commitPortableImport(
			target,
			await planPortableImport(target, archive, targetIdentity.profileId, keepAll(plan))
		);
		await expect(target.meals.get(seeded.meal.id)).resolves.toMatchObject({
			sourceRecipeId: otherMembersRecipeId
		});
	});

	test('collisions name the colliding record and bulk choices skip records that cannot take them', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const archive = await ownArchive(source, seeded.profileId);
		await source.households.update(seeded.householdId, { name: 'Renamed locally' });
		await source.recipes.update(seeded.recipe.id, { title: 'Local soup' });
		await source.userFoodPreferences.toCollection().modify({ preference: 'dislike' });

		const plan = await planPortableImport(source, archive, seeded.profileId);
		expect(plan.collisions.map(({ store, label }) => [store, label]).toSorted()).toEqual([
			['households', 'Family kitchen'],
			['recipes', 'Sunday soup'],
			['userFoodPreferences', 'Tomato']
		]);
		const copies = bulkResolutions(plan.collisions, 'import-as-copy');
		expect(Object.keys(copies)).toHaveLength(2);
		const resolved = await planPortableImport(source, archive, seeded.profileId, copies);
		expect(resolved.unresolvedCollisionIds).toEqual([
			plan.collisions.find(({ store }) => store === 'userFoodPreferences')!.collisionId
		]);
	});

	test('the recovery export is a portable archive the importer restores', async () => {
		const source = await openDatabase();
		const seeded = await seedContent(source);
		const recovery = await exportRecoveryArchives(source);
		expect(recovery.unreadable).toEqual([]);
		expect(recovery.archives.map(({ workosUserId }) => workosUserId)).toEqual([
			seeded.workosUserId
		]);
		const archive = await decodePortableArchive(recovery.archives[0]!.blob);
		expect(JSON.stringify(archive)).not.toContain('never-export-this');

		const target = await openDatabase();
		const targetIdentity = await seedIdentity(target, { withHousehold: false });
		await commitPortableImport(
			target,
			await planPortableImport(target, archive, targetIdentity.profileId)
		);
		await expect(target.recipes.get(seeded.recipe.id)).resolves.toMatchObject({
			title: 'Sunday soup'
		});
		await expect(target.meals.count()).resolves.toBe(1);
		await expect(target.mealCheckIns.count()).resolves.toBe(1);
	});

	test('the recovery export reports tables it could not read', async () => {
		const source = await openDatabase();
		await seedContent(source);
		const broken = {
			name: source.name,
			table: <T, TKey, TInsertType = T>(name: string) => {
				if (name === 'meals') throw new Error('The meals store is corrupt.');
				return source.table<T, TKey, TInsertType>(name);
			}
		};
		const recovery = await exportDecodableRecoveryData(broken, {
			recipes: Schema.Unknown,
			meals: Schema.Unknown
		});
		expect(recovery.records.recipes).toHaveLength(1);
		expect(recovery.unreadable).toEqual(['meals']);
	});
});
