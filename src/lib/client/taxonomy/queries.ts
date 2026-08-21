import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { TaxonomySnapshotSchema, type TaxonomySnapshot } from '$lib/domain/taxonomy/schema.js';
import {
	byScopeAndLocale,
	localeFallbacks,
	localeRank,
	normalizedAlias
} from '$lib/taxonomy/aliases.js';
import type {
	EffectiveTaxonomyPreferences,
	MassUnit,
	UnitPreferences,
	VolumeUnit
} from '$lib/taxonomy/preferences.js';

const ingredientUnitById: Readonly<Record<string, string>> = {
	grams: 'g',
	kilograms: 'kg',
	milligrams: 'mg',
	ounces: 'oz',
	pounds: 'lb',
	milliliters: 'ml',
	liters: 'l',
	centiliters: 'cl',
	deciliters: 'dl',
	teaspoons: 'tsp',
	tablespoons: 'tbsp',
	cups: 'cup',
	fluid_ounces: 'fl oz',
	pints: 'pint',
	quarts: 'quart',
	gallons: 'gal',
	each: 'each',
	pinches: 'pinch',
	dashes: 'dash',
	drops: 'drop',
	pieces: 'piece',
	cloves: 'clove',
	slices: 'slice',
	cans: 'can',
	bunches: 'bunch',
	handfuls: 'handful',
	sprigs: 'sprig',
	stalks: 'stalk',
	leaves: 'leaf',
	heads: 'head',
	bulbs: 'bulb',
	jars: 'jar',
	bottles: 'bottle',
	packages: 'package',
	packets: 'packet',
	seconds: 'second',
	minutes: 'minute',
	hours: 'hour',
	celsius: 'celsius',
	fahrenheit: 'fahrenheit'
};

export interface TaxonomyOption {
	value: string;
	label: string;
	keywords?: string[];
}

export interface TaxonomyOptions {
	weightPresetOptions: TaxonomyOption[];
	volumePresetOptions: TaxonomyOption[];
	temperaturePresetOptions: TaxonomyOption[];
	baseUnitOptions: TaxonomyOption[];
	unitAliasOptions: TaxonomyOption[];
	measureUnitOptions: TaxonomyOption[];
	foodOptions: TaxonomyOption[];
	foodAliasOptions: TaxonomyOption[];
}

export const readTaxonomySnapshot = async (database: MaalDatabase): Promise<TaxonomySnapshot> => {
	return database.transaction(
		'r',
		[
			database.foods,
			database.foodAliases,
			database.foodUserAliases,
			database.foodHouseholdAliases,
			database.foodUserEntries,
			database.foodHouseholdEntries,
			database.units,
			database.unitAliases,
			database.unitUserAliases,
			database.unitHouseholdAliases,
			database.unitUserEntries,
			database.unitHouseholdEntries,
			database.userFoodPreferences,
			database.userFoodDisplayPreferences,
			database.householdFoodDisplayPreferences,
			database.userUnitDisplayPreferences,
			database.householdUnitDisplayPreferences
		],
		async () => {
			const [
				foods,
				foodAliases,
				foodUserAliases,
				foodHouseholdAliases,
				foodUserEntries,
				foodHouseholdEntries,
				units,
				unitAliases,
				unitUserAliases,
				unitHouseholdAliases,
				unitUserEntries,
				unitHouseholdEntries,
				userFoodPreferences,
				userFoodDisplayPreferences,
				householdFoodDisplayPreferences,
				userUnitDisplayPreferences,
				householdUnitDisplayPreferences
			] = await Promise.all([
				database.foods.toArray(),
				database.foodAliases.toArray(),
				database.foodUserAliases.toArray(),
				database.foodHouseholdAliases.toArray(),
				database.foodUserEntries.toArray(),
				database.foodHouseholdEntries.toArray(),
				database.units.toArray(),
				database.unitAliases.toArray(),
				database.unitUserAliases.toArray(),
				database.unitHouseholdAliases.toArray(),
				database.unitUserEntries.toArray(),
				database.unitHouseholdEntries.toArray(),
				database.userFoodPreferences.toArray(),
				database.userFoodDisplayPreferences.toArray(),
				database.householdFoodDisplayPreferences.toArray(),
				database.userUnitDisplayPreferences.toArray(),
				database.householdUnitDisplayPreferences.toArray()
			]);
			return Schema.decodeUnknownSync(TaxonomySnapshotSchema)({
				foods,
				foodAliases,
				foodUserAliases,
				foodHouseholdAliases,
				foodUserEntries,
				foodHouseholdEntries,
				units,
				unitAliases,
				unitUserAliases,
				unitHouseholdAliases,
				unitUserEntries,
				unitHouseholdEntries,
				userFoodPreferences,
				userFoodDisplayPreferences,
				householdFoodDisplayPreferences,
				userUnitDisplayPreferences,
				householdUnitDisplayPreferences
			});
		}
	);
};

type RankedAlias = {
	id: string;
	alias: string;
	pluralAlias?: string | null;
	locale: string;
	scopeRank: number;
	unitId?: string;
	baseUnitId?: string;
	foodId?: string;
	defaultForLocale?: boolean;
};

const bestByKey = <T extends { locale: string; scopeRank: number }, K>(
	rows: readonly T[],
	key: (row: T) => K,
	ranks: Map<string, number>
): Map<K, T> => {
	const result = new Map<K, T>();
	for (const row of [...rows].sort(byScopeAndLocale(ranks))) {
		const rowKey = key(row);
		if (!result.has(rowKey)) result.set(rowKey, row);
	}
	return result;
};

const aliasesById = (rows: readonly RankedAlias[], ranks: Map<string, number>) =>
	bestByKey(rows, (row) => row.id, ranks);

const selectedAlias = (
	scope: string | null,
	id: string | null,
	globalAliases: Map<string, RankedAlias>,
	householdAliases: Map<string, RankedAlias>,
	userAliases: Map<string, RankedAlias>
): RankedAlias | undefined => {
	if (!id) return undefined;
	if (scope === 'user') return userAliases.get(id);
	if (scope === 'household') return householdAliases.get(id);
	return globalAliases.get(id);
};

export const loadEffectiveTaxonomyPreferences = async (
	database: MaalDatabase,
	params: { workosUserId: string; householdId: string; locale: string }
): Promise<EffectiveTaxonomyPreferences> => {
	const snapshot = await readTaxonomySnapshot(database);
	const fallbackLocales = localeFallbacks(params.locale);
	const localeSet = new Set(fallbackLocales);
	const ranks = localeRank(params.locale);
	const active = <T extends { deletedAt: string | null }>(rows: readonly T[]): T[] =>
		rows.filter((row) => row.deletedAt === null);

	const globalUnitAliases: RankedAlias[] = snapshot.unitAliases
		.filter((row) => localeSet.has(row.locale) && row.sourceDomain === null)
		.map((row) => ({ ...row, scopeRank: 2 }));
	const householdUnitAliases: RankedAlias[] = active(snapshot.unitHouseholdAliases)
		.filter((row) => row.householdId === params.householdId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 1 }));
	const userUnitAliases: RankedAlias[] = active(snapshot.unitUserAliases)
		.filter((row) => row.workosUserId === params.workosUserId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 0 }));
	const globalFoodAliases: RankedAlias[] = snapshot.foodAliases
		.filter((row) => localeSet.has(row.locale) && row.sourceDomain === null)
		.map((row) => ({ ...row, scopeRank: 2 }));
	const householdFoodAliases: RankedAlias[] = active(snapshot.foodHouseholdAliases)
		.filter((row) => row.householdId === params.householdId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 1 }));
	const userFoodAliases: RankedAlias[] = active(snapshot.foodUserAliases)
		.filter((row) => row.workosUserId === params.workosUserId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 0 }));

	const unitAliasLookup = bestByKey(
		[...userUnitAliases, ...householdUnitAliases, ...globalUnitAliases],
		(row) => normalizedAlias(row.alias),
		ranks
	);
	const defaultUnitLabels = bestByKey(
		globalUnitAliases.map((row) => ({
			...row,
			scopeRank: (ranks.get(row.locale) ?? 100) * 2 + (row.defaultForLocale ? 0 : 1)
		})),
		(row) => ingredientUnitById[row.unitId ?? ''] ?? row.unitId ?? '',
		ranks
	);

	const activeUserUnitEntries = active(snapshot.unitUserEntries).filter(
		(row) => row.workosUserId === params.workosUserId && row.adoptionStatus !== 'rejected'
	);
	const activeHouseholdUnitEntries = active(snapshot.unitHouseholdEntries).filter(
		(row) => row.householdId === params.householdId && row.adoptionStatus !== 'rejected'
	);
	const unitPreferences: UnitPreferences = {
		unitConversions: Object.fromEntries(
			[...snapshot.units, ...activeHouseholdUnitEntries, ...activeUserUnitEntries].map((unit) => [
				unit.id,
				{
					baseUnitId: unit.baseUnitId,
					toBaseFactor: unit.toBaseFactor,
					toBaseOffset: unit.toBaseOffset
				}
			])
		),
		unitAliases: Object.fromEntries(
			[...unitAliasLookup].flatMap(([alias, row]) => [
				[alias, row.unitId ?? ''],
				[row.alias, row.unitId ?? '']
			])
		),
		unitLabelOverrides: Object.fromEntries(
			[...defaultUnitLabels].map(([unit, alias]) => [unit, alias.alias])
		),
		unitPluralLabelOverrides: Object.fromEntries(
			[...defaultUnitLabels]
				.filter(([, alias]) => alias.pluralAlias)
				.map(([unit, alias]) => [unit, alias.pluralAlias!])
		),
		ingredientUnitOverrides: {},
		ingredientUnitLabelOverrides: {},
		ingredientUnitPluralLabelOverrides: {},
		ingredientNameOverrides: {}
	};

	const userUnitOverrides = active(snapshot.userUnitDisplayPreferences)
		.filter((row) => row.workosUserId === params.workosUserId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 0 }));
	const householdUnitOverrides = active(snapshot.householdUnitDisplayPreferences)
		.filter((row) => row.householdId === params.householdId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 1 }));
	const unitOverrides = bestByKey(
		[...userUnitOverrides, ...householdUnitOverrides],
		(row) => row.baseUnitId,
		ranks
	);
	const globalUnitById = aliasesById(globalUnitAliases, ranks);
	const householdUnitById = aliasesById(householdUnitAliases, ranks);
	const userUnitById = aliasesById(userUnitAliases, ranks);
	const unitDisplay: EffectiveTaxonomyPreferences['unitDisplay'] = {};
	for (const [baseUnitId, row] of unitOverrides) {
		const alias = selectedAlias(
			row.preferredUnitAliasScope,
			row.preferredUnitAliasId,
			globalUnitById,
			householdUnitById,
			userUnitById
		);
		const canonical = ingredientUnitById[row.preferredUnitId];
		unitDisplay[baseUnitId] = {
			unitId: row.preferredUnitId,
			alias: alias?.alias ?? canonical ?? row.preferredUnitId,
			...(alias?.pluralAlias ? { pluralAlias: alias.pluralAlias } : {})
		};
		if (baseUnitId === 'grams' && ['g', 'kg', 'oz', 'lb'].includes(canonical)) {
			unitPreferences.preferredMassUnit = canonical as MassUnit;
			unitPreferences.preferredMassUnitLabel = alias?.alias;
			unitPreferences.preferredMassUnitPluralLabel = alias?.pluralAlias ?? undefined;
		}
		if (
			baseUnitId === 'milliliters' &&
			['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz'].includes(canonical)
		) {
			unitPreferences.preferredVolumeUnit = canonical as VolumeUnit;
			unitPreferences.preferredVolumeUnitLabel = alias?.alias;
			unitPreferences.preferredVolumeUnitPluralLabel = alias?.pluralAlias ?? undefined;
		}
		if (baseUnitId === 'celsius' && ['celsius', 'fahrenheit'].includes(canonical)) {
			unitPreferences.preferredTemperatureUnit = canonical;
			unitPreferences.preferredTemperatureUnitLabel = alias?.alias;
		}
	}
	if (!unitPreferences.preferredTemperatureUnit) {
		unitPreferences.preferredTemperatureUnit = 'celsius';
		unitPreferences.preferredTemperatureUnitLabel = '°C';
	}

	const userFoodOverrides = active(snapshot.userFoodDisplayPreferences)
		.filter((row) => row.workosUserId === params.workosUserId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 0 }));
	const householdFoodOverrides = active(snapshot.householdFoodDisplayPreferences)
		.filter((row) => row.householdId === params.householdId && localeSet.has(row.locale))
		.map((row) => ({ ...row, scopeRank: 1 }));
	const foodOverrides = bestByKey(
		[...userFoodOverrides, ...householdFoodOverrides],
		(row) => row.foodId,
		ranks
	);
	const globalFoodById = aliasesById(globalFoodAliases, ranks);
	const householdFoodById = aliasesById(householdFoodAliases, ranks);
	const userFoodById = aliasesById(userFoodAliases, ranks);
	const foodDisplay: EffectiveTaxonomyPreferences['foodDisplay'] = {};
	for (const [foodId, row] of foodOverrides) {
		const alias = selectedAlias(
			row.preferredFoodAliasScope,
			row.preferredFoodAliasId,
			globalFoodById,
			householdFoodById,
			userFoodById
		);
		const preferredMeasureUnitId = row.preferredMeasureUnitId ?? undefined;
		const measureUnit = preferredMeasureUnitId
			? snapshot.units.find((unit) => unit.id === preferredMeasureUnitId)
			: undefined;
		const preferredMeasureAlias = preferredMeasureUnitId
			? (unitDisplay[measureUnit?.baseUnitId ?? '']?.alias ??
				ingredientUnitById[preferredMeasureUnitId] ??
				preferredMeasureUnitId)
			: undefined;
		if (alias) unitPreferences.ingredientNameOverrides![foodId] = alias.alias;
		if (preferredMeasureUnitId) {
			const canonical = ingredientUnitById[preferredMeasureUnitId];
			if (canonical) unitPreferences.ingredientUnitOverrides![foodId] = canonical;
			if (preferredMeasureAlias) {
				unitPreferences.ingredientUnitLabelOverrides![foodId] = preferredMeasureAlias;
			}
			const plural = unitDisplay[measureUnit?.baseUnitId ?? '']?.pluralAlias;
			if (plural) unitPreferences.ingredientUnitPluralLabelOverrides![foodId] = plural;
		}
		foodDisplay[foodId] = {
			...(alias ? { alias: alias.alias } : {}),
			...(preferredMeasureUnitId ? { preferredMeasureUnitId } : {}),
			...(preferredMeasureAlias ? { preferredMeasureAlias } : {})
		};
	}

	const foodPreferences = Object.fromEntries(
		active(snapshot.userFoodPreferences)
			.filter((row) => row.workosUserId === params.workosUserId)
			.map((row) => [
				row.foodId,
				{
					preference: row.preference,
					...(row.reason ? { reason: row.reason } : {})
				}
			])
	);

	return {
		locale: params.locale,
		localeFallbacks: fallbackLocales,
		unitPreferences,
		unitDisplay,
		foodDisplay,
		foodPreferences
	};
};

const labelFromId = (id: string): string => id.replaceAll('_', ' ');

export const loadTaxonomyOptions = async (
	database: MaalDatabase,
	params: { workosUserId: string; householdId: string; locale: string }
): Promise<TaxonomyOptions> => {
	const snapshot = await readTaxonomySnapshot(database);
	const effective = await loadEffectiveTaxonomyPreferences(database, params);
	const ranks = localeRank(params.locale);
	const localeSet = new Set(effective.localeFallbacks);
	const unitLabels = bestByKey(
		snapshot.unitAliases
			.filter((row) => localeSet.has(row.locale) && row.sourceDomain === null)
			.map((row) => ({ ...row, scopeRank: row.defaultForLocale ? 0 : 1 })),
		(row) => row.unitId,
		ranks
	);
	const foodLabels = bestByKey(
		snapshot.foodAliases
			.filter((row) => localeSet.has(row.locale) && row.sourceDomain === null)
			.map((row) => ({ ...row, scopeRank: row.defaultForLocale ? 0 : 1 })),
		(row) => row.foodId,
		ranks
	);
	const unitOption = (id: string, baseUnitId: string, label?: string): TaxonomyOption => ({
		value: id,
		label: label ?? labelFromId(id),
		keywords: [id, baseUnitId, labelFromId(id)]
	});
	const measureUnitOptions = [
		...snapshot.units.map((unit) =>
			unitOption(unit.id, unit.baseUnitId, unitLabels.get(unit.id)?.alias)
		),
		...snapshot.unitHouseholdEntries
			.filter(
				(row) =>
					row.deletedAt === null &&
					row.householdId === params.householdId &&
					row.adoptionStatus !== 'rejected'
			)
			.map((unit) => unitOption(unit.id, unit.baseUnitId, unit.canonicalLabel)),
		...snapshot.unitUserEntries
			.filter(
				(row) =>
					row.deletedAt === null &&
					row.workosUserId === params.workosUserId &&
					row.adoptionStatus !== 'rejected'
			)
			.map((unit) => unitOption(unit.id, unit.baseUnitId, unit.canonicalLabel))
	].sort((left, right) => left.label.localeCompare(right.label));
	const aliases = [...new Set(snapshot.unitAliases.map((alias) => alias.alias))].map((alias) => ({
		value: alias,
		label: alias
	}));
	const preset = (baseUnitId: string) =>
		snapshot.unitAliases
			.filter((alias) => alias.baseUnitId === baseUnitId && localeSet.has(alias.locale))
			.map((alias) => ({ value: alias.alias, label: alias.alias }))
			.filter(
				(option, index, rows) => rows.findIndex(({ value }) => value === option.value) === index
			);
	const foodOptions = [
		...snapshot.foods.map((food) => ({
			value: food.id,
			label:
				effective.foodDisplay[food.id]?.alias ??
				foodLabels.get(food.id)?.alias ??
				labelFromId(food.id),
			keywords: [food.id, labelFromId(food.id)]
		})),
		...snapshot.foodHouseholdEntries
			.filter(
				(row) =>
					row.deletedAt === null &&
					row.householdId === params.householdId &&
					row.adoptionStatus !== 'rejected'
			)
			.map((food) => ({ value: food.id, label: food.canonicalLabel })),
		...snapshot.foodUserEntries
			.filter(
				(row) =>
					row.deletedAt === null &&
					row.workosUserId === params.workosUserId &&
					row.adoptionStatus !== 'rejected'
			)
			.map((food) => ({ value: food.id, label: food.canonicalLabel }))
	].sort((left, right) => left.label.localeCompare(right.label));

	return {
		weightPresetOptions: preset('grams'),
		volumePresetOptions: preset('milliliters'),
		temperaturePresetOptions: preset('celsius'),
		baseUnitOptions: measureUnitOptions.filter((unit) =>
			snapshot.units.some((row) => row.id === unit.value && row.id === row.baseUnitId)
		),
		unitAliasOptions: aliases.sort((left, right) => left.label.localeCompare(right.label)),
		measureUnitOptions,
		foodOptions,
		foodAliasOptions: [...new Set(snapshot.foodAliases.map((alias) => alias.alias))]
			.map((alias) => ({ value: alias, label: alias }))
			.sort((left, right) => left.label.localeCompare(right.label))
	};
};
