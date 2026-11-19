import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { get } from 'svelte/store';
import { uuidv7 } from 'uuidv7';
import { afterEach, expect, test } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	createHouseholdTaxonomyEditorLiveQuery,
	createTaxonomyPreferencesLiveQuery,
	loadDisplayOverrideRows,
	loadEffectiveTaxonomyPreferences,
	saveHouseholdDisplayOverrides
} from '$lib/client/taxonomy/index.js';

const environment = `temperature-preference-${crypto.randomUUID()}`;
const databases: MaalDatabase[] = [];

afterEach(async () => {
	for (const database of databases) database.close();
	await Dexie.delete(`maal-v1:${environment}`);
});

test('keeps Fahrenheit through fallback-locale live updates and a fresh database reload', async () => {
	const params = {
		workosUserId: 'user_alice',
		householdId: 'household_one',
		locale: 'nl-BE'
	};
	const database = await openMaalDatabase(environment);
	databases.push(database);

	await expect(
		database.unitAliases
			.filter(
				(row) =>
					row.baseUnitId === 'celsius' && (row.locale === params.locale || row.locale === 'nl')
			)
			.count()
	).resolves.toBe(0);

	const editor = createHouseholdTaxonomyEditorLiveQuery(database, params);
	const preferences = createTaxonomyPreferencesLiveQuery(database, params);
	const editorUpdates: string[] = [];
	const preferenceUpdates: string[] = [];
	const unsubscribeEditor = editor.subscribe((view) => {
		editorUpdates.push(view.displayOverrideRows.preferredTemperatureUnit ?? 'unset');
	});
	const unsubscribePreferences = preferences.subscribe((value) => {
		preferenceUpdates.push(value.unitPreferences.preferredTemperatureUnit ?? 'unset');
	});

	await saveHouseholdDisplayOverrides(
		{
			database,
			authSlotId: 'slot-alice',
			originDeviceId: uuidv7(),
			occurredAt: '2026-08-22T08:00:00.000Z'
		},
		params,
		{
			preferredMassUnit: 'g',
			preferredVolumeUnit: 'ml',
			preferredTemperatureUnit: '°F',
			unitOverrides: [],
			ingredientOverrides: []
		}
	);

	await expect.poll(() => editorUpdates.at(-1)).toBe('°F');
	await expect.poll(() => preferenceUpdates.at(-1)).toBe('fahrenheit');
	expect(get(preferences).unitPreferences).toMatchObject({
		preferredTemperatureUnit: 'fahrenheit',
		preferredTemperatureUnitLabel: '°F'
	});

	const stored = await database.householdUnitDisplayPreferences
		.where('[householdId+baseUnitId+locale]')
		.equals([params.householdId, 'celsius', params.locale])
		.first();
	expect(stored).toMatchObject({
		baseUnitId: 'celsius',
		locale: 'nl-BE',
		preferredUnitId: 'fahrenheit',
		preferredUnitAliasScope: 'global',
		deletedAt: null
	});
	await expect(database.unitAliases.get(stored!.preferredUnitAliasId!)).resolves.toMatchObject({
		unitId: 'fahrenheit',
		baseUnitId: 'celsius',
		alias: '°F',
		locale: 'en-US'
	});

	unsubscribeEditor();
	unsubscribePreferences();
	database.close();

	const reopened = await openMaalDatabase(environment);
	databases.push(reopened);
	await expect(
		loadDisplayOverrideRows(reopened, params.householdId, params.locale)
	).resolves.toMatchObject({
		preferredTemperatureUnit: '°F'
	});
	await expect(loadEffectiveTaxonomyPreferences(reopened, params)).resolves.toMatchObject({
		unitPreferences: {
			preferredTemperatureUnit: 'fahrenheit',
			preferredTemperatureUnitLabel: '°F'
		},
		unitDisplay: {
			celsius: { unitId: 'fahrenheit', alias: '°F' }
		}
	});
});
