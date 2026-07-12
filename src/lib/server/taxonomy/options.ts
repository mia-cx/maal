import { isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { foodAliases, foods, unitAliases, units } from '$lib/server/db/schema';
import { localeFallbacks } from '$lib/domain/household/settings-parsing';

export type TaxonomyOption = { value: string; label: string; keywords?: string[] };

export type TaxonomyOptions = {
	weightPresetOptions: TaxonomyOption[];
	volumePresetOptions: TaxonomyOption[];
	temperaturePresetOptions: TaxonomyOption[];
	baseUnitOptions: TaxonomyOption[];
	unitAliasOptions: TaxonomyOption[];
	measureUnitOptions: TaxonomyOption[];
	foodOptions: TaxonomyOption[];
	foodAliasOptions: TaxonomyOption[];
};

export const emptyTaxonomyOptions = (): TaxonomyOptions => ({
	weightPresetOptions: [],
	volumePresetOptions: [],
	temperaturePresetOptions: [],
	baseUnitOptions: [],
	unitAliasOptions: [],
	measureUnitOptions: [],
	foodOptions: [],
	foodAliasOptions: []
});

const labelFromId = (id: string): string => id.replaceAll('_', ' ');

const PRESET_BASE_UNITS = {
	weightPresetOptions: 'grams',
	volumePresetOptions: 'milliliters',
	temperaturePresetOptions: 'celsius'
} as const;

export const loadTaxonomyOptions = async (
	database: D1Database,
	locale: string
): Promise<TaxonomyOptions> => {
	const db = getDb(database);
	const [unitRows, unitAliasRows, foodRows, foodAliasRows] = await Promise.all([
		db.select().from(units),
		db.select().from(unitAliases).where(isNull(unitAliases.sourceDomain)),
		db.select().from(foods),
		db.select().from(foodAliases).where(isNull(foodAliases.sourceDomain))
	]);
	const localeRank = new Map(localeFallbacks(locale).map((value, index) => [value, index]));
	const aliasSort = <T extends { locale: string; defaultForLocale: boolean; alias: string }>(
		left: T,
		right: T
	) =>
		(localeRank.get(left.locale) ?? 100) - (localeRank.get(right.locale) ?? 100) ||
		Number(right.defaultForLocale) - Number(left.defaultForLocale) ||
		left.alias.localeCompare(right.alias);
	const aliasesByUnit = new Map<string, typeof unitAliasRows>();
	for (const alias of unitAliasRows) {
		const bucket = aliasesByUnit.get(alias.unitId) ?? [];
		bucket.push(alias);
		aliasesByUnit.set(alias.unitId, bucket);
	}
	const aliasesByFood = new Map<string, typeof foodAliasRows>();
	for (const alias of foodAliasRows) {
		const bucket = aliasesByFood.get(alias.foodId) ?? [];
		bucket.push(alias);
		aliasesByFood.set(alias.foodId, bucket);
	}
	const unitLabel = (unitId: string) =>
		[...(aliasesByUnit.get(unitId) ?? [])].sort(aliasSort)[0]?.alias ?? labelFromId(unitId);
	const foodLabel = (foodId: string) =>
		[...(aliasesByFood.get(foodId) ?? [])].sort(aliasSort)[0]?.alias ?? labelFromId(foodId);
	const uniqueByValue = (options: TaxonomyOption[]) => [
		...new Map(options.map((option) => [option.value, option])).values()
	];
	const unitOption = (unit: (typeof unitRows)[number]): TaxonomyOption => ({
		value: unit.id,
		label: unitLabel(unit.id),
		keywords: [unit.id, unit.baseUnitId, labelFromId(unit.id)]
	});
	const unitAliasOption = (alias: (typeof unitAliasRows)[number]): TaxonomyOption => ({
		value: alias.alias,
		label: alias.alias,
		keywords: [alias.unitId, alias.baseUnitId, alias.locale]
	});

	const presetOptions = Object.fromEntries(
		Object.entries(PRESET_BASE_UNITS).map(([key, baseUnitId]) => [
			key,
			uniqueByValue(
				unitAliasRows.filter((alias) => alias.baseUnitId === baseUnitId).map(unitAliasOption)
			)
		])
	) as Pick<TaxonomyOptions, keyof typeof PRESET_BASE_UNITS>;

	return {
		...presetOptions,
		baseUnitOptions: unitRows
			.filter((unit) => unit.id === unit.baseUnitId)
			.map(unitOption)
			.toSorted((left, right) => left.label.localeCompare(right.label)),
		unitAliasOptions: uniqueByValue(unitAliasRows.map(unitAliasOption)).toSorted((left, right) =>
			left.label.localeCompare(right.label)
		),
		measureUnitOptions: unitRows
			.map(unitOption)
			.toSorted((left, right) => left.label.localeCompare(right.label)),
		foodOptions: foodRows
			.map((food) => ({
				value: food.id,
				label: foodLabel(food.id),
				keywords: [food.id, labelFromId(food.id)]
			}))
			.toSorted((left, right) => left.label.localeCompare(right.label)),
		foodAliasOptions: uniqueByValue(
			foodAliasRows.map((alias) => ({
				value: alias.alias,
				label: alias.alias,
				keywords: [alias.foodId, alias.locale]
			}))
		).toSorted((left, right) => left.label.localeCompare(right.label))
	};
};
