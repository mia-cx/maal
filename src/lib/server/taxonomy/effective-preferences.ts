import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { UnitPreferences } from '$lib/recipes/ingredient-text';
import type { EffectiveTaxonomyPreferences } from '$lib/taxonomy/preferences';
import {
	foodAliases,
	foodHouseholdAliases,
	foodUserAliases,
	householdFoodDisplayOverrides,
	householdUnitDisplayOverrides,
	unitAliases,
	unitHouseholdAliases,
	unitUserAliases,
	units,
	userFoodDisplayOverrides,
	userUnitDisplayOverrides
} from '$lib/server/db/schema';
import type * as schema from '$lib/server/db/schema';

type Db = DrizzleD1Database<typeof schema>;

type UnitDisplayOverride =
	| (typeof userUnitDisplayOverrides.$inferSelect & { scopeRank: 0 })
	| (typeof householdUnitDisplayOverrides.$inferSelect & { scopeRank: 1 });

type FoodDisplayOverride =
	| (typeof userFoodDisplayOverrides.$inferSelect & { scopeRank: 0 })
	| (typeof householdFoodDisplayOverrides.$inferSelect & { scopeRank: 1 });

const defaultLocale = 'en-US';

const unitIdToIngredientUnit: Record<string, string> = {
	grams: 'g',
	kilograms: 'kg',
	milligrams: 'mg',
	ounces: 'oz',
	pounds: 'lb',
	milliliters: 'ml',
	liters: 'l',
	teaspoons: 'tsp',
	tablespoons: 'tbsp',
	cups: 'cup',
	fluid_ounces: 'fl oz',
	celsius: 'celsius',
	fahrenheit: 'fahrenheit',
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
	bunches: 'bunch'
};

const normalizedInstructionUnitAlias = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[°º]\s*/gu, '')
		.replace(/\s+/gu, ' ')
		.replace(/[.,]+$/g, '');

const localeFallbacksFor = (locale: string): string[] => {
	try {
		const parsed = new Intl.Locale(locale);
		return [...new Set([parsed.toString(), parsed.language, defaultLocale])];
	} catch {
		return [defaultLocale];
	}
};

const bestByKey = <T extends { locale: string; scopeRank: number }, K>(
	rows: T[],
	key: (row: T) => K,
	localeRank: Map<string, number>
): Map<K, T> => {
	const ranked = rows.toSorted(
		(left, right) =>
			left.scopeRank - right.scopeRank ||
			(localeRank.get(left.locale) ?? 100) - (localeRank.get(right.locale) ?? 100)
	);
	const result = new Map<K, T>();
	for (const row of ranked) {
		const rowKey = key(row);
		if (!result.has(rowKey)) result.set(rowKey, row);
	}
	return result;
};

type UnitAliasLabel = { alias: string; pluralAlias?: string };

type AliasMaps = {
	unitGlobal: Map<string, UnitAliasLabel>;
	unitHousehold: Map<string, UnitAliasLabel>;
	unitUser: Map<string, UnitAliasLabel>;
	foodGlobal: Map<string, string>;
	foodHousehold: Map<string, string>;
	foodUser: Map<string, string>;
};

function aliasFrom(
	scope: string | null,
	id: string | null,
	aliases: AliasMaps,
	kind: 'unit'
): UnitAliasLabel | undefined;
function aliasFrom(
	scope: string | null,
	id: string | null,
	aliases: AliasMaps,
	kind: 'food'
): string | undefined;
function aliasFrom(
	scope: string | null,
	id: string | null,
	aliases: AliasMaps,
	kind: 'unit' | 'food'
): UnitAliasLabel | string | undefined {
	if (!id) return;
	if (kind === 'unit') {
		if (scope === 'user') return aliases.unitUser.get(id);
		if (scope === 'household') return aliases.unitHousehold.get(id);
		return aliases.unitGlobal.get(id);
	}
	if (scope === 'user') return aliases.foodUser.get(id);
	if (scope === 'household') return aliases.foodHousehold.get(id);
	return aliases.foodGlobal.get(id);
}

export const loadEffectiveTaxonomyPreferences = async (
	db: Db,
	params: { workosUserId: string; householdId: string; locale: string }
): Promise<EffectiveTaxonomyPreferences> => {
	const localeFallbacks = localeFallbacksFor(params.locale);
	const localeRank = new Map(localeFallbacks.map((locale, index) => [locale, index]));
	const [
		userUnitRows,
		householdUnitRows,
		userFoodRows,
		householdFoodRows,
		globalUnitAliases,
		householdScopedUnitAliases,
		userScopedUnitAliases,
		globalFoodAliases,
		householdScopedFoodAliases,
		userScopedFoodAliases,
		unitRows
	] = await Promise.all([
		db
			.select()
			.from(userUnitDisplayOverrides)
			.where(
				and(
					eq(userUnitDisplayOverrides.workosUserId, params.workosUserId),
					inArray(userUnitDisplayOverrides.locale, localeFallbacks)
				)
			),
		db
			.select()
			.from(householdUnitDisplayOverrides)
			.where(
				and(
					eq(householdUnitDisplayOverrides.householdId, params.householdId),
					inArray(householdUnitDisplayOverrides.locale, localeFallbacks)
				)
			),
		db
			.select()
			.from(userFoodDisplayOverrides)
			.where(
				and(
					eq(userFoodDisplayOverrides.workosUserId, params.workosUserId),
					inArray(userFoodDisplayOverrides.locale, localeFallbacks)
				)
			),
		db
			.select()
			.from(householdFoodDisplayOverrides)
			.where(
				and(
					eq(householdFoodDisplayOverrides.householdId, params.householdId),
					inArray(householdFoodDisplayOverrides.locale, localeFallbacks)
				)
			),
		db
			.select()
			.from(unitAliases)
			.where(and(inArray(unitAliases.locale, localeFallbacks), isNull(unitAliases.sourceDomain))),
		db
			.select()
			.from(unitHouseholdAliases)
			.where(eq(unitHouseholdAliases.householdId, params.householdId)),
		db.select().from(unitUserAliases).where(eq(unitUserAliases.workosUserId, params.workosUserId)),
		db
			.select()
			.from(foodAliases)
			.where(and(inArray(foodAliases.locale, localeFallbacks), isNull(foodAliases.sourceDomain))),
		db
			.select()
			.from(foodHouseholdAliases)
			.where(eq(foodHouseholdAliases.householdId, params.householdId)),
		db.select().from(foodUserAliases).where(eq(foodUserAliases.workosUserId, params.workosUserId)),
		db.select().from(units)
	]);

	const unitAliasLabel = (alias: { alias: string; pluralAlias?: string | null }) => ({
		alias: alias.alias,
		pluralAlias: alias.pluralAlias ?? undefined
	});
	const aliases = {
		unitGlobal: new Map(globalUnitAliases.map((alias) => [alias.id, unitAliasLabel(alias)])),
		unitHousehold: new Map(
			householdScopedUnitAliases.map((alias) => [alias.id, unitAliasLabel(alias)])
		),
		unitUser: new Map(userScopedUnitAliases.map((alias) => [alias.id, unitAliasLabel(alias)])),
		foodGlobal: new Map(globalFoodAliases.map((alias) => [alias.id, alias.alias])),
		foodHousehold: new Map(householdScopedFoodAliases.map((alias) => [alias.id, alias.alias])),
		foodUser: new Map(userScopedFoodAliases.map((alias) => [alias.id, alias.alias]))
	};
	const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
	const unitOverrides = bestByKey<UnitDisplayOverride, string>(
		[
			...userUnitRows.map((row) => ({ ...row, scopeRank: 0 as const })),
			...householdUnitRows.map((row) => ({ ...row, scopeRank: 1 as const }))
		],
		(row) => row.baseUnitId,
		localeRank
	);
	const foodOverrides = bestByKey<FoodDisplayOverride, string>(
		[
			...userFoodRows.map((row) => ({ ...row, scopeRank: 0 as const })),
			...householdFoodRows.map((row) => ({ ...row, scopeRank: 1 as const }))
		],
		(row) => row.foodId,
		localeRank
	);

	const unitPreferences: UnitPreferences = {
		unitConversions: Object.fromEntries(
			unitRows.map((unit) => [
				unit.id,
				{
					baseUnitId: unit.baseUnitId,
					toBaseFactor: unit.toBaseFactor,
					toBaseOffset: unit.toBaseOffset
				}
			])
		),
		unitAliases: Object.fromEntries(
			[...globalUnitAliases, ...householdScopedUnitAliases, ...userScopedUnitAliases].flatMap(
				(alias) => [
					[alias.alias, alias.unitId],
					[normalizedInstructionUnitAlias(alias.alias), alias.unitId]
				]
			)
		),
		ingredientUnitOverrides: {},
		ingredientUnitLabelOverrides: {},
		ingredientUnitPluralLabelOverrides: {},
		ingredientNameOverrides: {}
	};
	const unitDisplay: EffectiveTaxonomyPreferences['unitDisplay'] = {};
	for (const [baseUnitId, row] of unitOverrides) {
		const unitId = row.preferredUnitId;
		const canonical = unitIdToIngredientUnit[unitId];
		const alias = aliasFrom(row.preferredUnitAliasScope, row.preferredUnitAliasId, aliases, 'unit');
		if (baseUnitId === 'grams' && canonical && ['g', 'kg', 'oz', 'lb'].includes(canonical)) {
			unitPreferences.preferredMassUnit = canonical as UnitPreferences['preferredMassUnit'];
			unitPreferences.preferredMassUnitLabel = alias?.alias;
			unitPreferences.preferredMassUnitPluralLabel = alias?.pluralAlias;
		}
		if (
			baseUnitId === 'milliliters' &&
			canonical &&
			['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz'].includes(canonical)
		) {
			unitPreferences.preferredVolumeUnit = canonical as UnitPreferences['preferredVolumeUnit'];
			unitPreferences.preferredVolumeUnitLabel = alias?.alias;
			unitPreferences.preferredVolumeUnitPluralLabel = alias?.pluralAlias;
		}
		if (baseUnitId === 'celsius' && (canonical === 'celsius' || canonical === 'fahrenheit')) {
			unitPreferences.preferredTemperatureUnit =
				canonical as UnitPreferences['preferredTemperatureUnit'];
			unitPreferences.preferredTemperatureUnitLabel = alias?.alias;
		}
		unitDisplay[baseUnitId] = {
			unitId,
			alias: alias?.alias ?? canonical ?? unitId,
			pluralAlias: alias?.pluralAlias
		};
	}

	if (!unitPreferences.preferredTemperatureUnit) {
		unitPreferences.preferredTemperatureUnit = 'celsius';
		unitPreferences.preferredTemperatureUnitLabel = '°C';
	}

	const foodDisplay: EffectiveTaxonomyPreferences['foodDisplay'] = {};
	for (const [foodId, row] of foodOverrides) {
		const alias = aliasFrom(row.preferredFoodAliasScope, row.preferredFoodAliasId, aliases, 'food');
		const measureUnitId = row.preferredMeasureUnitId ?? undefined;
		const measureUnit = measureUnitId ? unitById.get(measureUnitId) : undefined;
		const measureAlias = measureUnitId
			? (unitDisplay[measureUnit?.baseUnitId ?? '']?.alias ??
				unitIdToIngredientUnit[measureUnitId] ??
				measureUnitId)
			: undefined;
		if (alias) unitPreferences.ingredientNameOverrides![foodId] = alias;
		if (measureUnitId) {
			const canonical = unitIdToIngredientUnit[measureUnitId];
			if (canonical) unitPreferences.ingredientUnitOverrides![foodId] = canonical;
			if (measureAlias) unitPreferences.ingredientUnitLabelOverrides![foodId] = measureAlias;
			const measurePluralAlias = unitDisplay[measureUnit?.baseUnitId ?? '']?.pluralAlias;
			if (measurePluralAlias)
				unitPreferences.ingredientUnitPluralLabelOverrides![foodId] = measurePluralAlias;
		}
		foodDisplay[foodId] = {
			alias,
			preferredMeasureUnitId: measureUnitId,
			preferredMeasureAlias: measureAlias
		};
	}

	return { locale: params.locale, localeFallbacks, unitPreferences, unitDisplay, foodDisplay };
};
