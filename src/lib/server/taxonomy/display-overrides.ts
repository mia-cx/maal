import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
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

type UnitAliasMatch = {
	unitId: string;
	baseUnitId: string;
	aliasScope: 'global';
	aliasId: string;
};

export const unitByAlias = async (
	database: D1Database,
	alias: string,
	baseUnitId?: string
): Promise<UnitAliasMatch | null> => {
	const db = getDb(database);
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
	householdId,
	locale,
	baseUnitId,
	preferredUnitAlias
}: {
	database: D1Database;
	householdId: string;
	locale: string;
	baseUnitId?: string;
	preferredUnitAlias: string;
}) => {
	const alias = preferredUnitAlias.trim();
	if (!alias) return;
	const db = getDb(database);
	const globalAlias = await unitByAlias(database, alias, baseUnitId);
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
	householdId,
	locale,
	row
}: {
	database: D1Database;
	householdId: string;
	locale: string;
	row: IngredientOverrideInput;
}) => {
	if (!row.baseFood) return;
	const db = getDb(database);
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
