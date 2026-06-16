import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';

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
		db.select().from(unitAliases),
		db.select().from(unitHouseholdAliases).where(eq(unitHouseholdAliases.householdId, householdId)),
		db.select().from(foodAliases),
		db.select().from(foodHouseholdAliases).where(eq(foodHouseholdAliases.householdId, householdId))
	]);
	const globalUnitAliasById = new Map(globalUnitAliases.map((alias) => [alias.id, alias.alias]));
	const householdUnitAliasById = new Map(
		householdUnitAliases.map((alias) => [alias.id, alias.alias])
	);
	const globalFoodAliasById = new Map(globalFoodAliases.map((alias) => [alias.id, alias.alias]));
	const householdFoodAliasById = new Map(
		householdFoodAliases.map((alias) => [alias.id, alias.alias])
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
	baseUnitId?: string
): Promise<UnitAliasMatch | null> => {
	const rows = await db
		.select()
		.from(unitAliases)
		.where(
			and(
				eq(unitAliases.alias, alias),
				isNull(unitAliases.sourceDomain),
				baseUnitId ? eq(unitAliases.baseUnitId, baseUnitId) : undefined
			)
		)
		.limit(1);
	const row = rows[0];
	return row
		? { unitId: row.unitId, baseUnitId: row.baseUnitId, aliasScope: 'global', aliasId: row.id }
		: null;
};

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
	const alias = preferredUnitAlias.trim();
	if (!alias) return;
	const db = inputDb ?? getDb(database);
	const globalAlias = await unitByAlias(db, alias, baseUnitId);
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
	const insertedAliases = await db
		.insert(unitHouseholdAliases)
		.values({ householdId, unitId: baseUnitId, baseUnitId, alias, locale })
		.returning({ id: unitHouseholdAliases.id });
	const aliasId = insertedAliases[0]?.id;
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
	if (!row.baseFood) return;
	const db = inputDb ?? getDb(database);
	const unitRows = row.preferredMeasureUnit
		? await db.select().from(units).where(eq(units.id, row.preferredMeasureUnit)).limit(1)
		: [];
	const measureUnit = unitRows[0];
	let preferredFoodAliasScope: 'global' | 'household' | null = null;
	let preferredFoodAliasId: string | null = null;
	const alias = row.preferredFoodAlias.trim();
	if (alias) {
		const globalAliases = await db
			.select()
			.from(foodAliases)
			.where(
				and(
					eq(foodAliases.foodId, row.baseFood),
					eq(foodAliases.alias, alias),
					isNull(foodAliases.sourceDomain)
				)
			)
			.limit(1);
		const globalAlias = globalAliases[0];
		if (globalAlias) {
			preferredFoodAliasScope = 'global';
			preferredFoodAliasId = globalAlias.id;
		} else {
			const insertedAliases = await db
				.insert(foodHouseholdAliases)
				.values({
					householdId,
					foodId: row.baseFood,
					alias,
					locale,
					defaultMeasureUnitId: measureUnit?.id,
					defaultMeasureBaseUnitId: measureUnit?.baseUnitId
				})
				.returning({ id: foodHouseholdAliases.id });
			preferredFoodAliasScope = 'household';
			preferredFoodAliasId = insertedAliases[0]?.id ?? null;
		}
	}
	await db
		.insert(householdFoodDisplayOverrides)
		.values({
			householdId,
			foodId: row.baseFood,
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
