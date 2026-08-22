import 'fake-indexeddb/auto';

import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import Dexie from 'dexie';
import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	commitPortableImport,
	createPortableArchiveBlob,
	decodePortableArchive,
	exportPortableArchive,
	planPortableImport,
	type PortableImportPlan
} from '$lib/client/portability/index.js';
import {
	planRecipeAsMeal,
	saveMealCheckIn,
	type MealCommandContext
} from '$lib/client/meals/index.js';
import {
	commitImportedRecipeCandidate,
	type RecipeCommandContext
} from '$lib/client/recipes/index.js';
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
