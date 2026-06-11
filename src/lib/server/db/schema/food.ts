import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { createdAt, id, updatedAt } from './common';
import { households } from './households';
import { units } from './units';
import { users } from './users';

const adoptionStatusValues = ['pending_review', 'accepted', 'rejected'] as const;

export const foods = sqliteTable(
	'foods',
	{
		id: text('id').primaryKey(),
		defaultMeasureUnitId: text('default_measure_unit_id').notNull(),
		defaultMeasureBaseUnitId: text('default_measure_base_unit_id').notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'foods_default_measure_unit_base_fk'
		})
	]
);

export const foodAliases = sqliteTable(
	'food_aliases',
	{
		id: id(),
		foodId: text('food_id')
			.notNull()
			.references(() => foods.id, { onDelete: 'cascade' }),
		alias: text('alias').notNull(),
		locale: text('locale').notNull(),
		sourceDomain: text('source_domain'),
		defaultForLocale: integer('default_for_locale', { mode: 'boolean' }).notNull().default(false),
		defaultMeasureUnitId: text('default_measure_unit_id'),
		defaultMeasureBaseUnitId: text('default_measure_base_unit_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_aliases_default_measure_unit_base_fk'
		}),
		uniqueIndex('food_aliases_default_per_food_locale')
			.on(table.foodId, table.locale)
			.where(sql`${table.defaultForLocale} = 1 AND ${table.sourceDomain} IS NULL`),
		index('food_aliases_food_id_idx').on(table.foodId),
		index('food_aliases_locale_alias_idx').on(table.locale, table.alias),
		index('food_aliases_import_lookup_idx').on(table.sourceDomain, table.locale, table.alias),
		check(
			'food_aliases_domain_not_default_check',
			sql`${table.sourceDomain} IS NULL OR ${table.defaultForLocale} = 0`
		),
		check(
			'food_aliases_default_measure_pair_check',
			sql`(${table.defaultMeasureUnitId} IS NULL AND ${table.defaultMeasureBaseUnitId} IS NULL) OR (${table.defaultMeasureUnitId} IS NOT NULL AND ${table.defaultMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

const scopedFoodAliasColumns = () => ({
	foodId: text('food_id')
		.notNull()
		.references(() => foods.id, { onDelete: 'cascade' }),
	alias: text('alias').notNull(),
	locale: text('locale').notNull(),
	sourceDomain: text('source_domain'),
	adoptionStatus: text('adoption_status', { enum: adoptionStatusValues })
		.notNull()
		.default('pending_review'),
	defaultMeasureUnitId: text('default_measure_unit_id'),
	defaultMeasureBaseUnitId: text('default_measure_base_unit_id')
});

export const foodUserAliases = sqliteTable(
	'food_user_aliases',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedFoodAliasColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_user_aliases_default_measure_unit_base_fk'
		}),
		index('food_user_aliases_user_idx').on(table.workosUserId),
		index('food_user_aliases_food_id_idx').on(table.foodId),
		index('food_user_aliases_lookup_idx').on(table.workosUserId, table.locale, table.alias),
		index('food_user_aliases_adoption_idx').on(table.adoptionStatus),
		check(
			'food_user_aliases_default_measure_pair_check',
			sql`(${table.defaultMeasureUnitId} IS NULL AND ${table.defaultMeasureBaseUnitId} IS NULL) OR (${table.defaultMeasureUnitId} IS NOT NULL AND ${table.defaultMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

export const foodHouseholdAliases = sqliteTable(
	'food_household_aliases',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedFoodAliasColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_household_aliases_default_measure_unit_base_fk'
		}),
		index('food_household_aliases_household_idx').on(table.householdId),
		index('food_household_aliases_food_id_idx').on(table.foodId),
		index('food_household_aliases_lookup_idx').on(table.householdId, table.locale, table.alias),
		index('food_household_aliases_adoption_idx').on(table.adoptionStatus),
		check(
			'food_household_aliases_default_measure_pair_check',
			sql`(${table.defaultMeasureUnitId} IS NULL AND ${table.defaultMeasureBaseUnitId} IS NULL) OR (${table.defaultMeasureUnitId} IS NOT NULL AND ${table.defaultMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

const scopedFoodEntryColumns = () => ({
	canonicalLabel: text('canonical_label').notNull(),
	defaultMeasureUnitId: text('default_measure_unit_id'),
	defaultMeasureBaseUnitId: text('default_measure_base_unit_id'),
	adoptionStatus: text('adoption_status', { enum: adoptionStatusValues })
		.notNull()
		.default('pending_review')
});

export const foodUserEntries = sqliteTable(
	'food_user_entries',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedFoodEntryColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('food_user_entries_label_unique').on(table.workosUserId, table.canonicalLabel),
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_user_entries_default_measure_unit_base_fk'
		}),
		index('food_user_entries_user_idx').on(table.workosUserId),
		index('food_user_entries_adoption_idx').on(table.adoptionStatus),
		check(
			'food_user_entries_default_measure_pair_check',
			sql`(${table.defaultMeasureUnitId} IS NULL AND ${table.defaultMeasureBaseUnitId} IS NULL) OR (${table.defaultMeasureUnitId} IS NOT NULL AND ${table.defaultMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

export const foodHouseholdEntries = sqliteTable(
	'food_household_entries',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedFoodEntryColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('food_household_entries_label_unique').on(table.householdId, table.canonicalLabel),
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_household_entries_default_measure_unit_base_fk'
		}),
		index('food_household_entries_household_idx').on(table.householdId),
		index('food_household_entries_adoption_idx').on(table.adoptionStatus),
		check(
			'food_household_entries_default_measure_pair_check',
			sql`(${table.defaultMeasureUnitId} IS NULL AND ${table.defaultMeasureBaseUnitId} IS NULL) OR (${table.defaultMeasureUnitId} IS NOT NULL AND ${table.defaultMeasureBaseUnitId} IS NOT NULL)`
		)
	]
);

export const userFoodPreferences = sqliteTable(
	'user_food_preferences',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		foodId: text('food_id')
			.notNull()
			.references(() => foods.id, { onDelete: 'cascade' }),
		preference: text('preference', {
			enum: ['favourite', 'like', 'dislike', 'disallowed']
		}).notNull(),
		reason: text('reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_food_preferences_user_food_unique').on(table.workosUserId, table.foodId),
		index('user_food_preferences_user_idx').on(table.workosUserId),
		index('user_food_preferences_food_idx').on(table.foodId),
		index('user_food_preferences_preference_idx').on(table.preference)
	]
);
