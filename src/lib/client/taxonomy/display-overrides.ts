import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { createDecodedLiveQuery } from '$lib/client/local/live-query.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { TaxonomyInvariantError } from '$lib/domain/contracts/errors.js';
import { localeFallbacks, localeRank, normalizedAlias } from '$lib/taxonomy/aliases.js';

import {
	deleteTaxonomyRecord,
	upsertTaxonomyRecord,
	type TaxonomyCommandContext
} from './commands.js';
import { loadTaxonomyOptions, type TaxonomyOptions } from './queries.js';

export type UnitOverrideInput = { baseUnit: string; preferredUnitAlias: string };
export type IngredientOverrideInput = {
	baseFood: string;
	preferredFoodAlias: string;
	preferredMeasureUnit: string;
};
export type DisplayOverrideRows = {
	preferredMassUnit?: string;
	preferredVolumeUnit?: string;
	preferredTemperatureUnit?: string;
	unitOverrides: readonly (UnitOverrideInput & { id: string })[];
	ingredientOverrides: readonly (IngredientOverrideInput & { id: string })[];
};

export type HouseholdTaxonomyEditorView = {
	displayOverrideRows: DisplayOverrideRows;
	taxonomyOptions: TaxonomyOptions;
};

export type HouseholdTaxonomyEditorParams = {
	workosUserId: string;
	householdId: string;
	locale: string;
};

export type SaveHouseholdDisplayOverridesInput = {
	preferredMassUnit: string;
	preferredVolumeUnit: string;
	preferredTemperatureUnit: string;
	unitOverrides: readonly UnitOverrideInput[];
	ingredientOverrides: readonly IngredientOverrideInput[];
};

const TaxonomyOptionSchema = Schema.Struct({
	value: Schema.String,
	label: Schema.String,
	keywords: Schema.optional(Schema.Array(Schema.String))
});

const DisplayOverrideRowsSchema = Schema.Struct({
	preferredMassUnit: Schema.optional(Schema.String),
	preferredVolumeUnit: Schema.optional(Schema.String),
	preferredTemperatureUnit: Schema.optional(Schema.String),
	unitOverrides: Schema.Array(
		Schema.Struct({ id: Schema.String, baseUnit: Schema.String, preferredUnitAlias: Schema.String })
	),
	ingredientOverrides: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			baseFood: Schema.String,
			preferredFoodAlias: Schema.String,
			preferredMeasureUnit: Schema.String
		})
	)
});

const HouseholdTaxonomyEditorViewSchema = Schema.Struct({
	displayOverrideRows: DisplayOverrideRowsSchema,
	taxonomyOptions: Schema.Struct({
		weightPresetOptions: Schema.Array(TaxonomyOptionSchema),
		volumePresetOptions: Schema.Array(TaxonomyOptionSchema),
		temperaturePresetOptions: Schema.Array(TaxonomyOptionSchema),
		baseUnitOptions: Schema.Array(TaxonomyOptionSchema),
		unitAliasOptions: Schema.Array(TaxonomyOptionSchema),
		measureUnitOptions: Schema.Array(TaxonomyOptionSchema),
		foodOptions: Schema.Array(TaxonomyOptionSchema),
		foodAliasOptions: Schema.Array(TaxonomyOptionSchema)
	})
});

export const emptyHouseholdTaxonomyEditorView = (): HouseholdTaxonomyEditorView => ({
	displayOverrideRows: { unitOverrides: [], ingredientOverrides: [] },
	taxonomyOptions: {
		weightPresetOptions: [],
		volumePresetOptions: [],
		temperaturePresetOptions: [],
		baseUnitOptions: [],
		unitAliasOptions: [],
		measureUnitOptions: [],
		foodOptions: [],
		foodAliasOptions: []
	}
});

const active = <T extends { deletedAt: string | null }>(rows: readonly T[]): T[] =>
	rows.filter((row) => row.deletedAt === null);

const bestLocaleRow = <T extends { locale: string }>(
	rows: readonly T[],
	locale: string
): T | undefined => {
	const ranks = localeRank(locale);
	return [...rows].sort(
		(left, right) => (ranks.get(left.locale) ?? 100) - (ranks.get(right.locale) ?? 100)
	)[0];
};

export const loadDisplayOverrideRows = async (
	database: MaalDatabase,
	householdId: string,
	locale: string
): Promise<DisplayOverrideRows> => {
	const fallbackLocales = new Set(localeFallbacks(locale));
	const [
		unitPreferences,
		foodPreferences,
		globalUnitAliases,
		householdUnitAliases,
		globalFoodAliases,
		householdFoodAliases
	] = await Promise.all([
		database.householdUnitDisplayPreferences
			.where('householdId')
			.equals(householdId)
			.filter((row) => row.deletedAt === null && row.locale === locale)
			.toArray(),
		database.householdFoodDisplayPreferences
			.where('householdId')
			.equals(householdId)
			.filter((row) => row.deletedAt === null && row.locale === locale)
			.toArray(),
		database.unitAliases.filter((row) => fallbackLocales.has(row.locale)).toArray(),
		database.unitHouseholdAliases
			.where('householdId')
			.equals(householdId)
			.filter((row) => row.deletedAt === null && fallbackLocales.has(row.locale))
			.toArray(),
		database.foodAliases.filter((row) => fallbackLocales.has(row.locale)).toArray(),
		database.foodHouseholdAliases
			.where('householdId')
			.equals(householdId)
			.filter((row) => row.deletedAt === null && fallbackLocales.has(row.locale))
			.toArray()
	]);
	const aliasFor = (
		scope: string | null,
		id: string | null,
		globalRows: readonly { id: string; alias: string; locale: string }[],
		householdRows: readonly { id: string; alias: string; locale: string }[]
	): string => {
		if (!id) return '';
		const rows = scope === 'household' ? householdRows : globalRows;
		return (
			bestLocaleRow(
				rows.filter((row) => row.id === id),
				locale
			)?.alias ?? ''
		);
	};
	const result: {
		preferredMassUnit?: string;
		preferredVolumeUnit?: string;
		preferredTemperatureUnit?: string;
		unitOverrides: Array<UnitOverrideInput & { id: string }>;
		ingredientOverrides: Array<IngredientOverrideInput & { id: string }>;
	} = { unitOverrides: [], ingredientOverrides: [] };
	for (const row of unitPreferences) {
		const alias = aliasFor(
			row.preferredUnitAliasScope,
			row.preferredUnitAliasId,
			globalUnitAliases,
			householdUnitAliases
		);
		if (!alias) continue;
		if (row.baseUnitId === 'grams') result.preferredMassUnit = alias;
		else if (row.baseUnitId === 'milliliters') result.preferredVolumeUnit = alias;
		else if (row.baseUnitId === 'celsius') result.preferredTemperatureUnit = alias;
		else {
			result.unitOverrides.push({
				id: row.id,
				baseUnit: row.baseUnitId,
				preferredUnitAlias: alias
			});
		}
	}
	for (const row of foodPreferences) {
		result.ingredientOverrides.push({
			id: row.id,
			baseFood: row.foodId,
			preferredFoodAlias: aliasFor(
				row.preferredFoodAliasScope,
				row.preferredFoodAliasId,
				globalFoodAliases,
				householdFoodAliases
			),
			preferredMeasureUnit: row.preferredMeasureUnitId ?? ''
		});
	}
	return result;
};

export const loadHouseholdTaxonomyEditorView = async (
	database: MaalDatabase,
	params: HouseholdTaxonomyEditorParams
): Promise<HouseholdTaxonomyEditorView> => {
	const [displayOverrideRows, taxonomyOptions] = await Promise.all([
		loadDisplayOverrideRows(database, params.householdId, params.locale),
		loadTaxonomyOptions(database, params)
	]);
	return { displayOverrideRows, taxonomyOptions };
};

export const createHouseholdTaxonomyEditorLiveQuery = (
	database: MaalDatabase,
	params: HouseholdTaxonomyEditorParams
) =>
	createDecodedLiveQuery({
		database,
		schema: HouseholdTaxonomyEditorViewSchema,
		initialValue: emptyHouseholdTaxonomyEditorView(),
		query: () => loadHouseholdTaxonomyEditorView(database, params)
	});

type UnitAliasMatch = {
	unitId: string;
	baseUnitId: string;
	aliasScope: 'global' | 'household';
	aliasId: string;
};

const unitByAlias = async (
	database: MaalDatabase,
	householdId: string,
	alias: string,
	locale: string,
	baseUnitId?: string
): Promise<UnitAliasMatch | null> => {
	const localeSet = new Set(localeFallbacks(locale));
	const matches = (candidate: { alias: string; locale: string; baseUnitId: string }) =>
		normalizedAlias(candidate.alias) === normalizedAlias(alias) &&
		localeSet.has(candidate.locale) &&
		(!baseUnitId || candidate.baseUnitId === baseUnitId);
	const global = bestLocaleRow(
		await database.unitAliases.filter((row) => row.sourceDomain === null && matches(row)).toArray(),
		locale
	);
	if (global) {
		return {
			unitId: global.unitId,
			baseUnitId: global.baseUnitId,
			aliasScope: 'global',
			aliasId: global.id
		};
	}
	const household = bestLocaleRow(
		active(
			await database.unitHouseholdAliases
				.where('householdId')
				.equals(householdId)
				.filter(matches)
				.toArray()
		),
		locale
	);
	return household
		? {
				unitId: household.unitId,
				baseUnitId: household.baseUnitId,
				aliasScope: 'household',
				aliasId: household.id
			}
		: null;
};

const invalid = (message: string): never => {
	throw new TaxonomyInvariantError({ operation: 'save household taxonomy overrides', message });
};

const upsertUnitDisplayOverride = async (
	context: TaxonomyCommandContext,
	params: { householdId: string; locale: string; baseUnitId?: string; preferredUnitAlias: string }
): Promise<void> => {
	const aliasText = params.preferredUnitAlias.trim();
	if (!aliasText) return;
	let alias = await unitByAlias(
		context.database,
		params.householdId,
		aliasText,
		params.locale,
		params.baseUnitId
	);
	if (!alias) {
		if (!params.baseUnitId) invalid('The selected unit alias does not exist.');
		const baseUnitId = params.baseUnitId ?? invalid('The selected base unit does not exist.');
		const existingUnit = await context.database.units.get(baseUnitId);
		if (!existingUnit || existingUnit.id !== existingUnit.baseUnitId) {
			invalid('A custom alias must reference a base unit.');
		}
		const created = await upsertTaxonomyRecord(context, 'unitHouseholdAlias', {
			id: uuidv7(),
			householdId: params.householdId,
			unitId: baseUnitId,
			baseUnitId,
			alias: aliasText,
			pluralAlias: null,
			locale: params.locale,
			sourceDomain: null,
			adoptionStatus: 'accepted'
		});
		alias = {
			unitId: created.unitId,
			baseUnitId: created.baseUnitId,
			aliasScope: 'household',
			aliasId: created.id
		};
	}
	const existing = await context.database.householdUnitDisplayPreferences
		.where('[householdId+baseUnitId+locale]')
		.equals([params.householdId, alias.baseUnitId, params.locale])
		.first();
	await upsertTaxonomyRecord(context, 'householdUnitDisplayPreference', {
		id: existing?.id ?? uuidv7(),
		householdId: params.householdId,
		baseUnitId: alias.baseUnitId,
		locale: params.locale,
		preferredUnitId: alias.unitId,
		preferredUnitAliasScope: alias.aliasScope,
		preferredUnitAliasId: alias.aliasId
	});
};

const upsertFoodDisplayOverride = async (
	context: TaxonomyCommandContext,
	params: { householdId: string; locale: string; row: IngredientOverrideInput }
): Promise<void> => {
	const baseFood = params.row.baseFood.trim();
	const aliasText = params.row.preferredFoodAlias.trim();
	const measureUnitId = params.row.preferredMeasureUnit.trim();
	if (!baseFood || !aliasText || !measureUnitId)
		invalid('Ingredient override rows must be complete.');
	if (!(await context.database.foods.get(baseFood))) invalid('The selected food does not exist.');
	const measureUnit =
		(await context.database.units.get(measureUnitId)) ??
		invalid('The selected measure unit does not exist.');
	const localeSet = new Set(localeFallbacks(params.locale));
	const globalAlias = bestLocaleRow(
		await context.database.foodAliases
			.filter(
				(row) =>
					row.foodId === baseFood &&
					row.sourceDomain === null &&
					localeSet.has(row.locale) &&
					normalizedAlias(row.alias) === normalizedAlias(aliasText)
			)
			.toArray(),
		params.locale
	);
	let preferredFoodAliasScope: 'global' | 'household';
	let preferredFoodAliasId: string;
	if (globalAlias) {
		preferredFoodAliasScope = 'global';
		preferredFoodAliasId = globalAlias.id;
	} else {
		const householdAlias = bestLocaleRow(
			active(
				await context.database.foodHouseholdAliases
					.where('householdId')
					.equals(params.householdId)
					.filter(
						(row) =>
							row.foodId === baseFood &&
							localeSet.has(row.locale) &&
							normalizedAlias(row.alias) === normalizedAlias(aliasText)
					)
					.toArray()
			),
			params.locale
		);
		const alias =
			householdAlias ??
			(await upsertTaxonomyRecord(context, 'foodHouseholdAlias', {
				id: uuidv7(),
				householdId: params.householdId,
				foodId: baseFood,
				alias: aliasText,
				locale: params.locale,
				sourceDomain: null,
				adoptionStatus: 'accepted',
				defaultMeasureUnitId: measureUnit.id,
				defaultMeasureBaseUnitId: measureUnit.baseUnitId
			}));
		preferredFoodAliasScope = 'household';
		preferredFoodAliasId = alias.id;
	}
	const existing = await context.database.householdFoodDisplayPreferences
		.where('[householdId+foodId+locale]')
		.equals([params.householdId, baseFood, params.locale])
		.first();
	await upsertTaxonomyRecord(context, 'householdFoodDisplayPreference', {
		id: existing?.id ?? uuidv7(),
		householdId: params.householdId,
		foodId: baseFood,
		locale: params.locale,
		preferredFoodAliasScope,
		preferredFoodAliasId,
		preferredMeasureUnitId: measureUnit.id,
		preferredMeasureBaseUnitId: measureUnit.baseUnitId
	});
};

export const saveHouseholdDisplayOverrides = async (
	context: TaxonomyCommandContext,
	params: HouseholdTaxonomyEditorParams,
	input: SaveHouseholdDisplayOverridesInput
): Promise<void> => {
	const presetRows = [
		{ baseUnit: 'grams', preferredUnitAlias: input.preferredMassUnit.trim() },
		{ baseUnit: 'milliliters', preferredUnitAlias: input.preferredVolumeUnit.trim() },
		{ baseUnit: 'celsius', preferredUnitAlias: input.preferredTemperatureUnit.trim() }
	];
	if (presetRows.some((row) => !row.preferredUnitAlias)) {
		invalid('Weight, volume, and temperature units are required.');
	}
	const unitRows = input.unitOverrides.map((row) => ({
		baseUnit: row.baseUnit.trim(),
		preferredUnitAlias: row.preferredUnitAlias.trim()
	}));
	if (unitRows.some((row) => !row.baseUnit || !row.preferredUnitAlias)) {
		invalid('Unit override rows must be complete.');
	}
	const ingredientRows = input.ingredientOverrides.map((row) => ({
		baseFood: row.baseFood.trim(),
		preferredFoodAlias: row.preferredFoodAlias.trim(),
		preferredMeasureUnit: row.preferredMeasureUnit.trim()
	}));
	if (
		ingredientRows.some(
			(row) => !row.baseFood || !row.preferredFoodAlias || !row.preferredMeasureUnit
		)
	) {
		invalid('Ingredient override rows must be complete.');
	}
	await Promise.all(
		unitRows.map(async (row) => {
			const baseUnit = await context.database.units.get(row.baseUnit);
			if (!baseUnit || baseUnit.id !== baseUnit.baseUnitId) {
				invalid('A unit override must reference a base unit.');
			}
		})
	);
	await Promise.all(
		ingredientRows.map(async (row) => {
			if (!(await context.database.foods.get(row.baseFood))) {
				invalid('An ingredient override must reference a known food.');
			}
			if (!(await context.database.units.get(row.preferredMeasureUnit))) {
				invalid('An ingredient override must reference a known measure unit.');
			}
		})
	);

	await upsertUnitDisplayOverride(context, {
		householdId: params.householdId,
		locale: params.locale,
		baseUnitId: 'grams',
		preferredUnitAlias: presetRows[0].preferredUnitAlias
	});
	await upsertUnitDisplayOverride(context, {
		householdId: params.householdId,
		locale: params.locale,
		baseUnitId: 'milliliters',
		preferredUnitAlias: presetRows[1].preferredUnitAlias
	});
	await upsertUnitDisplayOverride(context, {
		householdId: params.householdId,
		locale: params.locale,
		baseUnitId: 'celsius',
		preferredUnitAlias: presetRows[2].preferredUnitAlias
	});
	for (const row of unitRows) {
		await upsertUnitDisplayOverride(context, {
			householdId: params.householdId,
			locale: params.locale,
			baseUnitId: row.baseUnit,
			preferredUnitAlias: row.preferredUnitAlias
		});
	}
	const desiredUnitIds = new Set([
		...unitRows.map((row) => row.baseUnit),
		'grams',
		'milliliters',
		'celsius'
	]);
	const obsoleteUnitRows = active(
		await context.database.householdUnitDisplayPreferences
			.where('householdId')
			.equals(params.householdId)
			.filter((row) => row.locale === params.locale)
			.toArray()
	).filter((row) => !desiredUnitIds.has(row.baseUnitId));
	for (const row of obsoleteUnitRows) {
		await deleteTaxonomyRecord(context, 'householdUnitDisplayPreference', row.id);
	}

	for (const row of ingredientRows) {
		await upsertFoodDisplayOverride(context, {
			householdId: params.householdId,
			locale: params.locale,
			row
		});
	}
	const desiredFoodIds = new Set(ingredientRows.map((row) => row.baseFood));
	const obsoleteFoodRows = active(
		await context.database.householdFoodDisplayPreferences
			.where('householdId')
			.equals(params.householdId)
			.filter((row) => row.locale === params.locale)
			.toArray()
	).filter((row) => !desiredFoodIds.has(row.foodId));
	for (const row of obsoleteFoodRows) {
		await deleteTaxonomyRecord(context, 'householdFoodDisplayPreference', row.id);
	}
};
