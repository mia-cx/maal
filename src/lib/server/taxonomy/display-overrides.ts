import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { localeFallbacks } from '$lib/domain/household/settings-parsing';
import { bestAliasRowsById, localeRank } from './aliases';

type TaxonomyDb = ReturnType<typeof getDb>;
type TaxonomyTransaction = Parameters<Parameters<TaxonomyDb['transaction']>[0]>[0];
type DisplayOverrideDb = TaxonomyDb | TaxonomyTransaction;
import {
	foodAliases,
	foodHouseholdAliases,
	householdFoodDisplayOverrides,
	householdUnitDisplayOverrides,
	unitAliases,
	unitHouseholdAliases,
	units
} from '$lib/server/db/schema';

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
	unitOverrides: Array<UnitOverrideInput & { id: string }>;
	ingredientOverrides: Array<IngredientOverrideInput & { id: string }>;
};

export const loadDisplayOverrideRows = async (
	database: D1Database,
	householdId: string,
	locale: string
): Promise<DisplayOverrideRows> => {
	const db = getDb(database);
	const [
		unitOverrideRows,
		ingredientOverrideRows,
		globalUnitAliases,
		householdUnitAliases,
		globalFoodAliases,
		householdFoodAliases
	] = await Promise.all([
		db
			.select()
			.from(householdUnitDisplayOverrides)
			.where(
				and(
					eq(householdUnitDisplayOverrides.householdId, householdId),
					eq(householdUnitDisplayOverrides.locale, locale)
				)
			),
		db
			.select()
			.from(householdFoodDisplayOverrides)
			.where(
				and(
					eq(householdFoodDisplayOverrides.householdId, householdId),
					eq(householdFoodDisplayOverrides.locale, locale)
				)
			),
		db
			.select()
			.from(unitAliases)
			.where(inArray(unitAliases.locale, localeFallbacks(locale))),
		db
			.select()
			.from(unitHouseholdAliases)
			.where(
				and(
					eq(unitHouseholdAliases.householdId, householdId),
					inArray(unitHouseholdAliases.locale, localeFallbacks(locale))
				)
			),
		db
			.select()
			.from(foodAliases)
			.where(inArray(foodAliases.locale, localeFallbacks(locale))),
		db
			.select()
			.from(foodHouseholdAliases)
			.where(
				and(
					eq(foodHouseholdAliases.householdId, householdId),
					inArray(foodHouseholdAliases.locale, localeFallbacks(locale))
				)
			)
	]);
	const ranks = localeRank(locale);
	const globalUnitAliasById = new Map(
		[...bestAliasRowsById(globalUnitAliases, ranks)].map(([id, alias]) => [id, alias.alias])
	);
	const householdUnitAliasById = new Map(
		[...bestAliasRowsById(householdUnitAliases, ranks)].map(([id, alias]) => [id, alias.alias])
	);
	const globalFoodAliasById = new Map(
		[...bestAliasRowsById(globalFoodAliases, ranks)].map(([id, alias]) => [id, alias.alias])
	);
	const householdFoodAliasById = new Map(
		[...bestAliasRowsById(householdFoodAliases, ranks)].map(([id, alias]) => [id, alias.alias])
	);
	const unitAliasFor = (scope: string | null, id: string | null) => {
		if (!id) return '';
		return scope === 'household'
			? (householdUnitAliasById.get(id) ?? '')
			: (globalUnitAliasById.get(id) ?? '');
	};
	const foodAliasFor = (scope: string | null, id: string | null) => {
		if (!id) return '';
		return scope === 'household'
			? (householdFoodAliasById.get(id) ?? '')
			: (globalFoodAliasById.get(id) ?? '');
	};
	const result: DisplayOverrideRows = { unitOverrides: [], ingredientOverrides: [] };
	for (const row of unitOverrideRows) {
		const alias = unitAliasFor(row.preferredUnitAliasScope, row.preferredUnitAliasId);
		if (!alias) continue;
		if (row.baseUnitId === 'grams') result.preferredMassUnit = alias;
		else if (row.baseUnitId === 'milliliters') result.preferredVolumeUnit = alias;
		else if (row.baseUnitId === 'celsius') result.preferredTemperatureUnit = alias;
		else
			result.unitOverrides.push({
				id: row.id,
				baseUnit: row.baseUnitId,
				preferredUnitAlias: alias
			});
	}
	for (const row of ingredientOverrideRows) {
		result.ingredientOverrides.push({
			id: row.id,
			baseFood: row.foodId,
			preferredFoodAlias: foodAliasFor(row.preferredFoodAliasScope, row.preferredFoodAliasId),
			preferredMeasureUnit: row.preferredMeasureUnitId ?? ''
		});
	}
	return result;
};

type UnitAliasMatch = {
	unitId: string;
	baseUnitId: string;
	aliasScope: 'global';
	aliasId: string;
};

export const unitByAlias = async (
	db: DisplayOverrideDb,
	alias: string,
	locale: string,
	baseUnitId?: string
): Promise<UnitAliasMatch | null> => {
	const ranks = localeRank(locale);
	const rows = await db
		.select()
		.from(unitAliases)
		.where(
			and(
				eq(unitAliases.alias, alias),
				inArray(unitAliases.locale, localeFallbacks(locale)),
				isNull(unitAliases.sourceDomain),
				baseUnitId ? eq(unitAliases.baseUnitId, baseUnitId) : undefined
			)
		);
	const row = rows.toSorted(
		(left, right) => (ranks.get(left.locale) ?? 100) - (ranks.get(right.locale) ?? 100)
	)[0];
	return row
		? { unitId: row.unitId, baseUnitId: row.baseUnitId, aliasScope: 'global', aliasId: row.id }
		: null;
};

const stringField = (value: unknown): string | undefined =>
	typeof value === 'string' ? value.trim() : undefined;

export const upsertUnitDisplayOverride = async ({
	database,
	db: inputDb,
	householdId,
	locale,
	baseUnitId,
	preferredUnitAlias
}: {
	database: D1Database;
	db?: DisplayOverrideDb;
	householdId: string;
	locale: string;
	baseUnitId?: string;
	preferredUnitAlias: string;
}) => {
	const alias = stringField(preferredUnitAlias);
	if (!alias) return;
	const rootDb = getDb(database);
	if (!inputDb) {
		await rootDb.transaction((tx) =>
			upsertUnitDisplayOverride({
				database,
				db: tx,
				householdId,
				locale,
				baseUnitId,
				preferredUnitAlias: alias
			})
		);
		return;
	}
	const db = inputDb;
	const globalAlias = await unitByAlias(db, alias, locale, baseUnitId);
	if (globalAlias) {
		await db
			.insert(householdUnitDisplayOverrides)
			.values({
				householdId,
				baseUnitId: globalAlias.baseUnitId,
				locale,
				preferredUnitId: globalAlias.unitId,
				preferredUnitAliasScope: globalAlias.aliasScope,
				preferredUnitAliasId: globalAlias.aliasId
			})
			.onConflictDoUpdate({
				target: [
					householdUnitDisplayOverrides.householdId,
					householdUnitDisplayOverrides.baseUnitId,
					householdUnitDisplayOverrides.locale
				],
				set: {
					preferredUnitId: globalAlias.unitId,
					preferredUnitAliasScope: globalAlias.aliasScope,
					preferredUnitAliasId: globalAlias.aliasId,
					updatedAt: new Date().toISOString()
				}
			});
		return;
	}
	if (!baseUnitId) return;
	const aliasIdentity = and(
		eq(unitHouseholdAliases.householdId, householdId),
		eq(unitHouseholdAliases.baseUnitId, baseUnitId),
		eq(unitHouseholdAliases.alias, alias),
		eq(unitHouseholdAliases.locale, locale)
	);
	const insertedAliases = await db
		.insert(unitHouseholdAliases)
		.values({ householdId, unitId: baseUnitId, baseUnitId, alias, locale })
		.onConflictDoNothing({
			target: [
				unitHouseholdAliases.householdId,
				unitHouseholdAliases.baseUnitId,
				unitHouseholdAliases.locale,
				unitHouseholdAliases.alias
			]
		})
		.returning({ id: unitHouseholdAliases.id });
	const aliasId =
		insertedAliases[0]?.id ??
		(
			await db
				.select({ id: unitHouseholdAliases.id })
				.from(unitHouseholdAliases)
				.where(aliasIdentity)
				.orderBy(asc(unitHouseholdAliases.id))
				.limit(1)
		)[0]?.id;
	if (!aliasId) return;
	await db
		.insert(householdUnitDisplayOverrides)
		.values({
			householdId,
			baseUnitId,
			locale,
			preferredUnitId: baseUnitId,
			preferredUnitAliasScope: 'household',
			preferredUnitAliasId: aliasId
		})
		.onConflictDoUpdate({
			target: [
				householdUnitDisplayOverrides.householdId,
				householdUnitDisplayOverrides.baseUnitId,
				householdUnitDisplayOverrides.locale
			],
			set: {
				preferredUnitId: baseUnitId,
				preferredUnitAliasScope: 'household',
				preferredUnitAliasId: aliasId,
				updatedAt: new Date().toISOString()
			}
		});
};

export const upsertFoodDisplayOverride = async ({
	database,
	db: inputDb,
	householdId,
	locale,
	row
}: {
	database: D1Database;
	db?: DisplayOverrideDb;
	householdId: string;
	locale: string;
	row: IngredientOverrideInput;
}) => {
	const baseFood = stringField(row.baseFood);
	const preferredFoodAlias = stringField(row.preferredFoodAlias) ?? '';
	const preferredMeasureUnit = stringField(row.preferredMeasureUnit) ?? '';
	if (!baseFood) return;
	const rootDb = getDb(database);
	if (!inputDb) {
		await rootDb.transaction((tx) =>
			upsertFoodDisplayOverride({
				database,
				db: tx,
				householdId,
				locale,
				row: { baseFood, preferredFoodAlias, preferredMeasureUnit }
			})
		);
		return;
	}
	const db = inputDb;
	const unitRows = preferredMeasureUnit
		? await db.select().from(units).where(eq(units.id, preferredMeasureUnit)).limit(1)
		: [];
	const measureUnit = unitRows[0];
	let preferredFoodAliasScope: 'global' | 'household' | null = null;
	let preferredFoodAliasId: string | null = null;
	const alias = preferredFoodAlias;
	if (alias) {
		const globalAliases = await db
			.select()
			.from(foodAliases)
			.where(
				and(
					eq(foodAliases.foodId, baseFood),
					eq(foodAliases.alias, alias),
					inArray(foodAliases.locale, localeFallbacks(locale)),
					isNull(foodAliases.sourceDomain)
				)
			);
		const ranks = localeRank(locale);
		const globalAlias = globalAliases.toSorted(
			(left, right) => (ranks.get(left.locale) ?? 100) - (ranks.get(right.locale) ?? 100)
		)[0];
		if (globalAlias) {
			preferredFoodAliasScope = 'global';
			preferredFoodAliasId = globalAlias.id;
		} else {
			const aliasIdentity = and(
				eq(foodHouseholdAliases.householdId, householdId),
				eq(foodHouseholdAliases.foodId, baseFood),
				eq(foodHouseholdAliases.alias, alias),
				eq(foodHouseholdAliases.locale, locale)
			);
			const insertedAliases = await db
				.insert(foodHouseholdAliases)
				.values({
					householdId,
					foodId: baseFood,
					alias,
					locale,
					defaultMeasureUnitId: measureUnit?.id,
					defaultMeasureBaseUnitId: measureUnit?.baseUnitId
				})
				.onConflictDoNothing({
					target: [
						foodHouseholdAliases.householdId,
						foodHouseholdAliases.foodId,
						foodHouseholdAliases.locale,
						foodHouseholdAliases.alias
					]
				})
				.returning({ id: foodHouseholdAliases.id });
			const aliasId =
				insertedAliases[0]?.id ??
				(
					await db
						.select({ id: foodHouseholdAliases.id })
						.from(foodHouseholdAliases)
						.where(aliasIdentity)
						.orderBy(asc(foodHouseholdAliases.id))
						.limit(1)
				)[0]?.id;
			preferredFoodAliasScope = 'household';
			preferredFoodAliasId = aliasId ?? null;
		}
	}
	await db
		.insert(householdFoodDisplayOverrides)
		.values({
			householdId,
			foodId: baseFood,
			locale,
			preferredFoodAliasScope,
			preferredFoodAliasId,
			preferredMeasureUnitId: measureUnit?.id,
			preferredMeasureBaseUnitId: measureUnit?.baseUnitId
		})
		.onConflictDoUpdate({
			target: [
				householdFoodDisplayOverrides.householdId,
				householdFoodDisplayOverrides.foodId,
				householdFoodDisplayOverrides.locale
			],
			set: {
				preferredFoodAliasScope,
				preferredFoodAliasId,
				preferredMeasureUnitId: measureUnit?.id,
				preferredMeasureBaseUnitId: measureUnit?.baseUnitId,
				updatedAt: new Date().toISOString()
			}
		});
};
