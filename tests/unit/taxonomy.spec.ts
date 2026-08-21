import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { get } from 'svelte/store';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	createTaxonomyPreferencesLiveQuery,
	decodeTaxonomyRecord,
	deleteTaxonomyRecord,
	encodeTaxonomyRecord,
	loadEffectiveTaxonomyPreferences,
	upsertTaxonomyRecord,
	type TaxonomyCommandContext,
	type TaxonomyDraft,
	type TaxonomyEditableRecordMap
} from '$lib/client/taxonomy/index.js';
import {
	convertQuantity,
	fromBaseQuantity,
	toBaseQuantity
} from '$lib/domain/taxonomy/conversion.js';
import { GLOBAL_TAXONOMY_SEED_VERSION } from '$lib/domain/taxonomy/global-seed.js';
import {
	FoodAliasSchema,
	FoodUserAliasSchema,
	HouseholdFoodDisplayPreferenceSchema,
	type TaxonomyEditableEntityKind
} from '$lib/domain/taxonomy/schema.js';
import { displayIngredient, displayIngredientAmount } from '$lib/taxonomy/display.js';

const databases: MaalDatabase[] = [];
const databaseNames = new Set<string>();

const openDatabase = async (): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(`taxonomy-${crypto.randomUUID()}`);
	databases.push(database);
	databaseNames.add(database.name);
	return database;
};

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
	databases.length = 0;
	databaseNames.clear();
});

const timestamp = '2026-08-21T12:00:00.000Z';

const addFoodFixture = async (database: MaalDatabase): Promise<void> => {
	await database.foods.put({
		id: 'tomatoes',
		defaultMeasureUnitId: 'grams',
		defaultMeasureBaseUnitId: 'grams'
	});
	await database.foodAliases.put({
		id: 'food_alias_tomatoes_en',
		foodId: 'tomatoes',
		alias: 'tomatoes',
		locale: 'en-US',
		sourceDomain: null,
		defaultForLocale: true,
		defaultMeasureUnitId: 'grams',
		defaultMeasureBaseUnitId: 'grams',
		createdAt: timestamp,
		updatedAt: timestamp
	});
};

const commandContext = (database: MaalDatabase): TaxonomyCommandContext => ({
	database,
	authSlotId: 'slot-alice',
	originDeviceId: uuidv7(),
	occurredAt: timestamp
});

describe('global taxonomy seed', () => {
	test('installs the complete versioned prototype unit families and localized aliases idempotently', async () => {
		const database = await openDatabase();

		expect(await database.units.count()).toBe(40);
		expect(await database.unitAliases.count()).toBeGreaterThan(150);
		await expect(database.units.get('fahrenheit')).resolves.toEqual({
			id: 'fahrenheit',
			baseUnitId: 'celsius',
			toBaseFactor: 0.555555555555556,
			toBaseOffset: -17.7777777777778
		});
		await expect(
			database.unitAliases.filter((row) => row.alias === 'teentje').first()
		).resolves.toMatchObject({
			unitId: 'cloves',
			baseUnitId: 'cloves',
			locale: 'nl-NL',
			pluralAlias: 'teentjes',
			sourceDomain: null,
			defaultForLocale: false
		});
		await expect(database.meta.get('taxonomySeedVersion')).resolves.toMatchObject({
			value: GLOBAL_TAXONOMY_SEED_VERSION
		});

		const count = await database.unitAliases.count();
		database.close();
		const reopened = await openMaalDatabase(database.name.slice('maal-v1:'.length));
		databases.push(reopened);
		await expect(reopened.unitAliases.count()).resolves.toBe(count);
	});
});

describe('Effect taxonomy contracts', () => {
	test('enforces paired references, domain defaults, adoption states, and alias scope pairs', () => {
		const baseAlias = {
			id: uuidv7(),
			foodId: 'tomatoes',
			alias: 'tomato',
			locale: 'en-US',
			sourceDomain: null,
			defaultForLocale: false,
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null,
			createdAt: timestamp,
			updatedAt: timestamp
		};
		expect(Schema.decodeUnknownSync(FoodAliasSchema)(baseAlias)).toEqual(baseAlias);
		expect(() =>
			Schema.decodeUnknownSync(FoodAliasSchema)({
				...baseAlias,
				sourceDomain: 'recipes.example',
				defaultForLocale: true
			})
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(FoodAliasSchema)({
				...baseAlias,
				defaultMeasureUnitId: 'grams'
			})
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(FoodUserAliasSchema)({
				...baseAlias,
				workosUserId: 'user_alice',
				adoptionStatus: 'maybe',
				schemaVersion: 1,
				revision: 1,
				deletedAt: null,
				conflictClocks: {}
			})
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(HouseholdFoodDisplayPreferenceSchema)({
				id: uuidv7(),
				householdId: 'household_one',
				foodId: 'tomatoes',
				locale: 'en-US',
				preferredFoodAliasScope: 'household',
				preferredFoodAliasId: null,
				preferredMeasureUnitId: null,
				preferredMeasureBaseUnitId: null,
				schemaVersion: 1,
				revision: 1,
				createdAt: timestamp,
				updatedAt: timestamp,
				deletedAt: null,
				conflictClocks: {}
			})
		).toThrow();
	});
});

describe('offline taxonomy commands and lossless round trips', () => {
	test('writes every editable row family with its outbox mutation and survives a D1-shaped JSON round trip', async () => {
		const database = await openDatabase();
		const replica = await openDatabase();
		await addFoodFixture(database);
		const context = commandContext(database);
		const userFoodAliasId = uuidv7();
		const householdFoodAliasId = uuidv7();
		const userUnitAliasId = uuidv7();
		const householdUnitAliasId = uuidv7();
		const fixtures: {
			[K in TaxonomyEditableEntityKind]: TaxonomyDraft<TaxonomyEditableRecordMap[K]>;
		} = {
			foodUserAlias: {
				id: userFoodAliasId,
				workosUserId: 'user_alice',
				foodId: 'tomatoes',
				alias: 'pomodori',
				locale: 'it-IT',
				sourceDomain: 'recipes.example',
				adoptionStatus: 'accepted',
				defaultMeasureUnitId: 'kilograms',
				defaultMeasureBaseUnitId: 'grams'
			},
			foodHouseholdAlias: {
				id: householdFoodAliasId,
				householdId: 'household_one',
				foodId: 'tomatoes',
				alias: 'tomaatjes',
				locale: 'nl-NL',
				sourceDomain: null,
				adoptionStatus: 'pending_review',
				defaultMeasureUnitId: null,
				defaultMeasureBaseUnitId: null
			},
			foodUserEntry: {
				id: uuidv7(),
				workosUserId: 'user_alice',
				canonicalLabel: 'smoked salt',
				defaultMeasureUnitId: 'grams',
				defaultMeasureBaseUnitId: 'grams',
				adoptionStatus: 'accepted'
			},
			foodHouseholdEntry: {
				id: uuidv7(),
				householdId: 'household_one',
				canonicalLabel: 'weeknight sauce',
				defaultMeasureUnitId: null,
				defaultMeasureBaseUnitId: null,
				adoptionStatus: 'rejected'
			},
			unitUserAlias: {
				id: userUnitAliasId,
				workosUserId: 'user_alice',
				unitId: 'kilograms',
				baseUnitId: 'grams',
				alias: 'kilo bag',
				pluralAlias: 'kilo bags',
				locale: 'en-NL',
				sourceDomain: 'recipes.example',
				adoptionStatus: 'accepted'
			},
			unitHouseholdAlias: {
				id: householdUnitAliasId,
				householdId: 'household_one',
				unitId: 'kilograms',
				baseUnitId: 'grams',
				alias: 'grote kilo',
				pluralAlias: null,
				locale: 'nl-NL',
				sourceDomain: null,
				adoptionStatus: 'pending_review'
			},
			unitUserEntry: {
				id: uuidv7(),
				workosUserId: 'user_alice',
				canonicalLabel: 'half gram scoop',
				baseUnitId: 'grams',
				toBaseFactor: 0.5,
				toBaseOffset: 0.25,
				adoptionStatus: 'accepted'
			},
			unitHouseholdEntry: {
				id: uuidv7(),
				householdId: 'household_one',
				canonicalLabel: 'house scoop',
				baseUnitId: 'grams',
				toBaseFactor: 12.5,
				toBaseOffset: -0.5,
				adoptionStatus: 'pending_review'
			},
			userFoodPreference: {
				id: uuidv7(),
				workosUserId: 'user_alice',
				foodId: 'tomatoes',
				preference: 'favourite',
				reason: 'Sunday sauce'
			},
			userFoodDisplayPreference: {
				id: uuidv7(),
				workosUserId: 'user_alice',
				foodId: 'tomatoes',
				locale: 'it-IT',
				preferredFoodAliasScope: 'user',
				preferredFoodAliasId: userFoodAliasId,
				preferredMeasureUnitId: 'kilograms',
				preferredMeasureBaseUnitId: 'grams'
			},
			householdFoodDisplayPreference: {
				id: uuidv7(),
				householdId: 'household_one',
				foodId: 'tomatoes',
				locale: 'nl-NL',
				preferredFoodAliasScope: 'household',
				preferredFoodAliasId: householdFoodAliasId,
				preferredMeasureUnitId: null,
				preferredMeasureBaseUnitId: null
			},
			userUnitDisplayPreference: {
				id: uuidv7(),
				workosUserId: 'user_alice',
				baseUnitId: 'grams',
				locale: 'en-NL',
				preferredUnitId: 'kilograms',
				preferredUnitAliasScope: 'user',
				preferredUnitAliasId: userUnitAliasId
			},
			householdUnitDisplayPreference: {
				id: uuidv7(),
				householdId: 'household_one',
				baseUnitId: 'grams',
				locale: 'nl-NL',
				preferredUnitId: 'kilograms',
				preferredUnitAliasScope: 'household',
				preferredUnitAliasId: householdUnitAliasId
			}
		};

		const storeByKind: Record<TaxonomyEditableEntityKind, string> = {
			foodUserAlias: 'foodUserAliases',
			foodHouseholdAlias: 'foodHouseholdAliases',
			foodUserEntry: 'foodUserEntries',
			foodHouseholdEntry: 'foodHouseholdEntries',
			unitUserAlias: 'unitUserAliases',
			unitHouseholdAlias: 'unitHouseholdAliases',
			unitUserEntry: 'unitUserEntries',
			unitHouseholdEntry: 'unitHouseholdEntries',
			userFoodPreference: 'userFoodPreferences',
			userFoodDisplayPreference: 'userFoodDisplayPreferences',
			householdFoodDisplayPreference: 'householdFoodDisplayPreferences',
			userUnitDisplayPreference: 'userUnitDisplayPreferences',
			householdUnitDisplayPreference: 'householdUnitDisplayPreferences'
		};
		const records = new Map<
			TaxonomyEditableEntityKind,
			TaxonomyEditableRecordMap[TaxonomyEditableEntityKind]
		>();
		for (const kind of Object.keys(fixtures) as TaxonomyEditableEntityKind[]) {
			const record = await upsertTaxonomyRecord(context, kind, fixtures[kind] as never);
			records.set(kind, record);
		}

		expect(await database.outbox.count()).toBe(Object.keys(fixtures).length);
		for (const [kind, record] of records) {
			const d1Json = JSON.stringify(encodeTaxonomyRecord(kind, record as never));
			const restored = decodeTaxonomyRecord(kind, JSON.parse(d1Json));
			expect(restored).toEqual(record);
			await replica.table(storeByKind[kind]).put(restored);
			await expect(replica.table(storeByKind[kind]).get(record.id)).resolves.toEqual(record);
		}
		const mutation = await database.outbox
			.filter((row) => row.entityKind === 'foodUserAlias')
			.first();
		expect(mutation).toMatchObject({
			scopeKind: 'user',
			scopeId: 'user_alice',
			payload: {
				sourceDomain: 'recipes.example',
				adoptionStatus: 'accepted',
				defaultMeasureUnitId: 'kilograms',
				defaultMeasureBaseUnitId: 'grams'
			}
		});
	});

	test('rejects broken composite references and preserves atomicity', async () => {
		const database = await openDatabase();
		await addFoodFixture(database);

		await expect(
			upsertTaxonomyRecord(commandContext(database), 'foodUserAlias', {
				id: uuidv7(),
				workosUserId: 'user_alice',
				foodId: 'tomatoes',
				alias: 'broken',
				locale: 'en-US',
				sourceDomain: null,
				adoptionStatus: 'accepted',
				defaultMeasureUnitId: 'kilograms',
				defaultMeasureBaseUnitId: 'milliliters'
			})
		).rejects.toMatchObject({ _tag: 'TaxonomyInvariantError' });
		await expect(database.foodUserAliases.count()).resolves.toBe(0);
		await expect(database.outbox.count()).resolves.toBe(0);
	});

	test('enforces equivalent user and household identity uniqueness in IndexedDB', async () => {
		const database = await openDatabase();
		await addFoodFixture(database);
		const context = commandContext(database);
		const base = {
			workosUserId: 'user_alice',
			foodId: 'tomatoes',
			alias: 'tomato',
			locale: 'en-US',
			sourceDomain: null,
			adoptionStatus: 'accepted' as const,
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null
		};
		await upsertTaxonomyRecord(context, 'foodUserAlias', { id: uuidv7(), ...base });
		await expect(
			upsertTaxonomyRecord(context, 'foodUserAlias', { id: uuidv7(), ...base })
		).rejects.toMatchObject({ _tag: 'LocalPersistenceError' });
		await expect(database.foodUserAliases.count()).resolves.toBe(1);
		await expect(database.outbox.count()).resolves.toBe(1);
	});
});

describe('query-time resolution and affine conversion', () => {
	test('derives user over household preferences without storing an effective cache', async () => {
		const database = await openDatabase();
		await addFoodFixture(database);
		const context = commandContext(database);
		const householdAlias = await upsertTaxonomyRecord(context, 'foodHouseholdAlias', {
			id: uuidv7(),
			householdId: 'household_one',
			foodId: 'tomatoes',
			alias: 'tomaatjes',
			locale: 'nl-NL',
			sourceDomain: null,
			adoptionStatus: 'accepted',
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null
		});
		const userAlias = await upsertTaxonomyRecord(context, 'foodUserAlias', {
			id: uuidv7(),
			workosUserId: 'user_alice',
			foodId: 'tomatoes',
			alias: 'mijn tomaat',
			locale: 'nl-NL',
			sourceDomain: null,
			adoptionStatus: 'accepted',
			defaultMeasureUnitId: null,
			defaultMeasureBaseUnitId: null
		});
		await upsertTaxonomyRecord(context, 'householdFoodDisplayPreference', {
			id: uuidv7(),
			householdId: 'household_one',
			foodId: 'tomatoes',
			locale: 'nl-NL',
			preferredFoodAliasScope: 'household',
			preferredFoodAliasId: householdAlias.id,
			preferredMeasureUnitId: null,
			preferredMeasureBaseUnitId: null
		});
		const userDisplay = await upsertTaxonomyRecord(context, 'userFoodDisplayPreference', {
			id: uuidv7(),
			workosUserId: 'user_alice',
			foodId: 'tomatoes',
			locale: 'nl-NL',
			preferredFoodAliasScope: 'user',
			preferredFoodAliasId: userAlias.id,
			preferredMeasureUnitId: null,
			preferredMeasureBaseUnitId: null
		});

		const effective = await loadEffectiveTaxonomyPreferences(database, {
			workosUserId: 'user_alice',
			householdId: 'household_one',
			locale: 'nl-NL'
		});
		expect(effective.foodDisplay.tomatoes?.alias).toBe('mijn tomaat');
		expect(effective.unitPreferences.ingredientNameOverrides?.tomatoes).toBe('mijn tomaat');
		expect(Object.keys(await database.uiState.toArray())).not.toContain('effectiveTaxonomy');

		await deleteTaxonomyRecord(context, 'userFoodDisplayPreference', userDisplay.id);
		const householdFallback = await loadEffectiveTaxonomyPreferences(database, {
			workosUserId: 'user_alice',
			householdId: 'household_one',
			locale: 'nl-NL'
		});
		expect(householdFallback.foodDisplay.tomatoes?.alias).toBe('tomaatjes');
	});

	test('applies factor and offset in both directions and rejects cross-family conversion', async () => {
		const database = await openDatabase();
		const celsius = (await database.units.get('celsius'))!;
		const fahrenheit = (await database.units.get('fahrenheit'))!;
		const grams = (await database.units.get('grams'))!;

		expect(toBaseQuantity(212, fahrenheit)).toBeCloseTo(100);
		expect(fromBaseQuantity(100, fahrenheit)).toBeCloseTo(212);
		expect(convertQuantity(212, fahrenheit, celsius)).toBeCloseTo(100);
		expect(() => convertQuantity(1, grams, celsius)).toThrowError(
			/Units from different base families/
		);
	});

	test('emits Dexie preference changes through the preserved live-query UI seam', async () => {
		const database = await openDatabase();
		await addFoodFixture(database);
		const values: string[] = [];
		const live = createTaxonomyPreferencesLiveQuery(database, {
			workosUserId: 'user_alice',
			householdId: 'household_one',
			locale: 'en-US'
		});
		const unsubscribe = live.subscribe((value) => {
			values.push(value.foodPreferences.tomatoes?.preference ?? 'unset');
		});

		await upsertTaxonomyRecord(commandContext(database), 'userFoodPreference', {
			id: uuidv7(),
			workosUserId: 'user_alice',
			foodId: 'tomatoes',
			preference: 'dislike',
			reason: 'Too acidic'
		});
		await expect.poll(() => values.at(-1)).toBe('dislike');
		expect(get(live).foodPreferences.tomatoes).toEqual({
			preference: 'dislike',
			reason: 'Too acidic'
		});
		unsubscribe();
	});
});

describe('prototype display compatibility', () => {
	test('retains preferred mass and ingredient-specific display behavior', async () => {
		const database = await openDatabase();
		const preferences = await loadEffectiveTaxonomyPreferences(database, {
			workosUserId: 'user_alice',
			householdId: 'household_one',
			locale: 'en-US'
		});
		preferences.unitPreferences.preferredMassUnit = 'lb';
		preferences.unitPreferences.preferredMassUnitLabel = 'pounds';
		expect(displayIngredientAmount(453.59237, 'grams', preferences)).toBe('1 pounds');
		expect(
			displayIngredient(
				{
					sourceQuantity: 2,
					sourceUnitLabel: 'clove',
					sourceFoodLabel: 'knoflook',
					originalText: '2 cloves knoflook'
				},
				{
					unitLabelOverrides: { clove: 'teen' },
					unitPluralLabelOverrides: { clove: 'tenen' }
				}
			).text
		).toBe('2 tenen knoflook');
	});
});
