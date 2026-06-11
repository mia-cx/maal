import { sql } from 'drizzle-orm';
import { check, foreignKey, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, updatedAt } from './common';
import { foods } from './food';
import { households } from './households';
import { units } from './units';
import { users } from './users';

const userAliasScopeValues = ['global', 'household', 'user'] as const;
const householdAliasScopeValues = ['global', 'household'] as const;

const userFoodAliasScope = () => text('preferred_food_alias_scope', { enum: userAliasScopeValues });
const householdFoodAliasScope = () =>
	text('preferred_food_alias_scope', { enum: householdAliasScopeValues });
const userUnitAliasScope = () => text('preferred_unit_alias_scope', { enum: userAliasScopeValues });
const householdUnitAliasScope = () =>
	text('preferred_unit_alias_scope', { enum: householdAliasScopeValues });

export const userFoodDisplayOverrides = sqliteTable(
	'user_food_display_overrides',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		foodId: text('food_id')
			.notNull()
			.references(() => foods.id, { onDelete: 'cascade' }),
		locale: text('locale').notNull(),
		preferredFoodAliasScope: userFoodAliasScope(),
		preferredFoodAliasId: text('preferred_food_alias_id'),
		preferredMeasureUnitId: text('preferred_measure_unit_id'),
		preferredMeasureBaseUnitId: text('preferred_measure_base_unit_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_food_display_overrides_unique').on(
			table.workosUserId,
			table.foodId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredMeasureUnitId, table.preferredMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_food_display_overrides_measure_unit_base_fk'
		}),
		index('user_food_display_overrides_user_idx').on(table.workosUserId),
		index('user_food_display_overrides_food_locale_idx').on(table.foodId, table.locale),
		check(
			'user_food_display_overrides_alias_pair_check',
			sql`(${table.preferredFoodAliasScope} IS NULL AND ${table.preferredFoodAliasId} IS NULL) OR (${table.preferredFoodAliasScope} IS NOT NULL AND ${table.preferredFoodAliasId} IS NOT NULL)`
		),
		check(
			'user_food_display_overrides_measure_pair_check',
			sql`(${table.preferredMeasureUnitId} IS NULL AND ${table.preferredMeasureBaseUnitId} IS NULL) OR (${table.preferredMeasureUnitId} IS NOT NULL AND ${table.preferredMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

export const householdFoodDisplayOverrides = sqliteTable(
	'household_food_display_overrides',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		foodId: text('food_id')
			.notNull()
			.references(() => foods.id, { onDelete: 'cascade' }),
		locale: text('locale').notNull(),
		preferredFoodAliasScope: householdFoodAliasScope(),
		preferredFoodAliasId: text('preferred_food_alias_id'),
		preferredMeasureUnitId: text('preferred_measure_unit_id'),
		preferredMeasureBaseUnitId: text('preferred_measure_base_unit_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('household_food_display_overrides_unique').on(
			table.householdId,
			table.foodId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredMeasureUnitId, table.preferredMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'household_food_display_overrides_measure_unit_base_fk'
		}),
		index('household_food_display_overrides_household_idx').on(table.householdId),
		index('household_food_display_overrides_food_locale_idx').on(table.foodId, table.locale),
		check(
			'household_food_display_overrides_alias_pair_check',
			sql`(${table.preferredFoodAliasScope} IS NULL AND ${table.preferredFoodAliasId} IS NULL) OR (${table.preferredFoodAliasScope} IS NOT NULL AND ${table.preferredFoodAliasId} IS NOT NULL)`
		),
		check(
			'household_food_display_overrides_measure_pair_check',
			sql`(${table.preferredMeasureUnitId} IS NULL AND ${table.preferredMeasureBaseUnitId} IS NULL) OR (${table.preferredMeasureUnitId} IS NOT NULL AND ${table.preferredMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

export const userUnitDisplayOverrides = sqliteTable(
	'user_unit_display_overrides',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		baseUnitId: text('base_unit_id')
			.notNull()
			.references(() => units.id),
		locale: text('locale').notNull(),
		preferredUnitId: text('preferred_unit_id').notNull(),
		preferredUnitAliasScope: userUnitAliasScope(),
		preferredUnitAliasId: text('preferred_unit_alias_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_unit_display_overrides_unique').on(
			table.workosUserId,
			table.baseUnitId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredUnitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_unit_display_overrides_preferred_unit_base_fk'
		}),
		index('user_unit_display_overrides_user_idx').on(table.workosUserId),
		index('user_unit_display_overrides_base_locale_idx').on(table.baseUnitId, table.locale),
		check(
			'user_unit_display_overrides_alias_pair_check',
			sql`(${table.preferredUnitAliasScope} IS NULL AND ${table.preferredUnitAliasId} IS NULL) OR (${table.preferredUnitAliasScope} IS NOT NULL AND ${table.preferredUnitAliasId} IS NOT NULL)`
		)
	]
);

export const householdUnitDisplayOverrides = sqliteTable(
	'household_unit_display_overrides',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		baseUnitId: text('base_unit_id')
			.notNull()
			.references(() => units.id),
		locale: text('locale').notNull(),
		preferredUnitId: text('preferred_unit_id').notNull(),
		preferredUnitAliasScope: householdUnitAliasScope(),
		preferredUnitAliasId: text('preferred_unit_alias_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('household_unit_display_overrides_unique').on(
			table.householdId,
			table.baseUnitId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredUnitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'household_unit_display_overrides_preferred_unit_base_fk'
		}),
		index('household_unit_display_overrides_household_idx').on(table.householdId),
		index('household_unit_display_overrides_base_locale_idx').on(table.baseUnitId, table.locale),
		check(
			'household_unit_display_overrides_alias_pair_check',
			sql`(${table.preferredUnitAliasScope} IS NULL AND ${table.preferredUnitAliasId} IS NULL) OR (${table.preferredUnitAliasScope} IS NOT NULL AND ${table.preferredUnitAliasId} IS NOT NULL)`
		)
	]
);
