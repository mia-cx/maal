import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { createdAt, enumCheck, mutableColumns, nullablePair, updatedAt } from './common.js';
import {
	adoptionStatusValues,
	aliasScopeValues,
	foodPreferenceValues,
	householdAliasScopeValues
} from './enums.js';
import { households, users } from './identity.js';

export const units = sqliteTable(
	'units',
	{
		id: text('id').primaryKey(),
		baseUnitId: text('base_unit_id').notNull(),
		toBaseFactor: real('to_base_factor').notNull().default(1),
		toBaseOffset: real('to_base_offset').notNull().default(0)
	},
	(table) => [
		uniqueIndex('units_id_base_unit_unique').on(table.id, table.baseUnitId),
		foreignKey({
			columns: [table.baseUnitId],
			foreignColumns: [table.id],
			name: 'units_base_unit_fk'
		})
	]
);

export const unitAliases = sqliteTable(
	'unit_aliases',
	{
		id: text('id').primaryKey(),
		unitId: text('unit_id').notNull(),
		baseUnitId: text('base_unit_id').notNull(),
		alias: text('alias').notNull(),
		pluralAlias: text('plural_alias'),
		locale: text('locale').notNull(),
		sourceDomain: text('source_domain'),
		defaultForLocale: integer('default_for_locale', { mode: 'boolean' }).notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'unit_aliases_unit_base_fk'
		}).onDelete('cascade'),
		uniqueIndex('unit_aliases_default_per_base_locale')
			.on(table.baseUnitId, table.locale)
			.where(sql`${table.defaultForLocale} = 1 AND ${table.sourceDomain} IS NULL`),
		index('unit_aliases_unit_idx').on(table.unitId),
		index('unit_aliases_lookup_idx').on(table.sourceDomain, table.locale, table.alias),
		check(
			'unit_aliases_domain_not_default_check',
			sql`${table.sourceDomain} IS NULL OR ${table.defaultForLocale} = 0`
		)
	]
);

const scopedUnitAliasColumns = () => ({
	unitId: text('unit_id').notNull(),
	baseUnitId: text('base_unit_id').notNull(),
	alias: text('alias').notNull(),
	pluralAlias: text('plural_alias'),
	locale: text('locale').notNull(),
	sourceDomain: text('source_domain'),
	adoptionStatus: text('adoption_status', { enum: adoptionStatusValues })
		.notNull()
		.default('pending_review')
});

export const unitUserAliases = sqliteTable(
	'unit_user_aliases',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedUnitAliasColumns(),
		...mutableColumns()
	},
	(table) => [
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'unit_user_aliases_unit_base_fk'
		}).onDelete('cascade'),
		uniqueIndex('unit_user_aliases_identity_unique').on(
			table.workosUserId,
			table.baseUnitId,
			table.locale,
			table.alias
		),
		index('unit_user_aliases_lookup_idx').on(table.workosUserId, table.locale, table.alias),
		enumCheck('unit_user_aliases_adoption_check', table.adoptionStatus, adoptionStatusValues)
	]
);

export const unitHouseholdAliases = sqliteTable(
	'unit_household_aliases',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedUnitAliasColumns(),
		...mutableColumns()
	},
	(table) => [
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'unit_household_aliases_unit_base_fk'
		}).onDelete('cascade'),
		uniqueIndex('unit_household_aliases_identity_unique').on(
			table.householdId,
			table.baseUnitId,
			table.locale,
			table.alias
		),
		index('unit_household_aliases_lookup_idx').on(table.householdId, table.locale, table.alias),
		enumCheck('unit_household_aliases_adoption_check', table.adoptionStatus, adoptionStatusValues)
	]
);

const scopedUnitEntryColumns = () => ({
	canonicalLabel: text('canonical_label').notNull(),
	baseUnitId: text('base_unit_id')
		.notNull()
		.references(() => units.id),
	toBaseFactor: real('to_base_factor').notNull().default(1),
	toBaseOffset: real('to_base_offset').notNull().default(0),
	adoptionStatus: text('adoption_status', { enum: adoptionStatusValues })
		.notNull()
		.default('pending_review')
});

export const unitUserEntries = sqliteTable(
	'unit_user_entries',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedUnitEntryColumns(),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('unit_user_entries_label_unique').on(table.workosUserId, table.canonicalLabel),
		index('unit_user_entries_base_idx').on(table.baseUnitId),
		enumCheck('unit_user_entries_adoption_check', table.adoptionStatus, adoptionStatusValues)
	]
);

export const unitHouseholdEntries = sqliteTable(
	'unit_household_entries',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedUnitEntryColumns(),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('unit_household_entries_label_unique').on(table.householdId, table.canonicalLabel),
		index('unit_household_entries_base_idx').on(table.baseUnitId),
		enumCheck('unit_household_entries_adoption_check', table.adoptionStatus, adoptionStatusValues)
	]
);

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

const nullableDefaultMeasureColumns = () => ({
	defaultMeasureUnitId: text('default_measure_unit_id'),
	defaultMeasureBaseUnitId: text('default_measure_base_unit_id')
});

export const foodAliases = sqliteTable(
	'food_aliases',
	{
		id: text('id').primaryKey(),
		foodId: text('food_id')
			.notNull()
			.references(() => foods.id, { onDelete: 'cascade' }),
		alias: text('alias').notNull(),
		locale: text('locale').notNull(),
		sourceDomain: text('source_domain'),
		defaultForLocale: integer('default_for_locale', { mode: 'boolean' }).notNull().default(false),
		...nullableDefaultMeasureColumns(),
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
		index('food_aliases_lookup_idx').on(table.sourceDomain, table.locale, table.alias),
		check(
			'food_aliases_domain_not_default_check',
			sql`${table.sourceDomain} IS NULL OR ${table.defaultForLocale} = 0`
		),
		check(
			'food_aliases_default_measure_pair_check',
			nullablePair(table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId)
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
	...nullableDefaultMeasureColumns()
});

export const foodUserAliases = sqliteTable(
	'food_user_aliases',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedFoodAliasColumns(),
		...mutableColumns()
	},
	(table) => [
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_user_aliases_default_measure_unit_base_fk'
		}),
		uniqueIndex('food_user_aliases_identity_unique').on(
			table.workosUserId,
			table.foodId,
			table.locale,
			table.alias
		),
		index('food_user_aliases_lookup_idx').on(table.workosUserId, table.locale, table.alias),
		enumCheck('food_user_aliases_adoption_check', table.adoptionStatus, adoptionStatusValues),
		check(
			'food_user_aliases_default_measure_pair_check',
			nullablePair(table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId)
		)
	]
);

export const foodHouseholdAliases = sqliteTable(
	'food_household_aliases',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedFoodAliasColumns(),
		...mutableColumns()
	},
	(table) => [
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_household_aliases_default_measure_unit_base_fk'
		}),
		uniqueIndex('food_household_aliases_identity_unique').on(
			table.householdId,
			table.foodId,
			table.locale,
			table.alias
		),
		index('food_household_aliases_lookup_idx').on(table.householdId, table.locale, table.alias),
		enumCheck('food_household_aliases_adoption_check', table.adoptionStatus, adoptionStatusValues),
		check(
			'food_household_aliases_default_measure_pair_check',
			nullablePair(table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId)
		)
	]
);

const scopedFoodEntryColumns = () => ({
	canonicalLabel: text('canonical_label').notNull(),
	...nullableDefaultMeasureColumns(),
	adoptionStatus: text('adoption_status', { enum: adoptionStatusValues })
		.notNull()
		.default('pending_review')
});

export const foodUserEntries = sqliteTable(
	'food_user_entries',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedFoodEntryColumns(),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('food_user_entries_label_unique').on(table.workosUserId, table.canonicalLabel),
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_user_entries_default_measure_unit_base_fk'
		}),
		enumCheck('food_user_entries_adoption_check', table.adoptionStatus, adoptionStatusValues),
		check(
			'food_user_entries_default_measure_pair_check',
			nullablePair(table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId)
		)
	]
);

export const foodHouseholdEntries = sqliteTable(
	'food_household_entries',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedFoodEntryColumns(),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('food_household_entries_label_unique').on(table.householdId, table.canonicalLabel),
		foreignKey({
			columns: [table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'food_household_entries_default_measure_unit_base_fk'
		}),
		enumCheck('food_household_entries_adoption_check', table.adoptionStatus, adoptionStatusValues),
		check(
			'food_household_entries_default_measure_pair_check',
			nullablePair(table.defaultMeasureUnitId, table.defaultMeasureBaseUnitId)
		)
	]
);

export const userFoodPreferences = sqliteTable(
	'user_food_preferences',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		foodId: text('food_id')
			.notNull()
			.references(() => foods.id, { onDelete: 'cascade' }),
		preference: text('preference', { enum: foodPreferenceValues }).notNull(),
		reason: text('reason'),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('user_food_preferences_user_food_unique').on(table.workosUserId, table.foodId),
		index('user_food_preferences_user_idx').on(table.workosUserId),
		enumCheck('user_food_preferences_preference_check', table.preference, foodPreferenceValues)
	]
);

const foodDisplayColumns = () => ({
	foodId: text('food_id')
		.notNull()
		.references(() => foods.id, { onDelete: 'cascade' }),
	locale: text('locale').notNull(),
	preferredFoodAliasId: text('preferred_food_alias_id'),
	preferredMeasureUnitId: text('preferred_measure_unit_id'),
	preferredMeasureBaseUnitId: text('preferred_measure_base_unit_id'),
	...mutableColumns()
});

export const userFoodDisplayPreferences = sqliteTable(
	'user_food_display_overrides',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		preferredFoodAliasScope: text('preferred_food_alias_scope', { enum: aliasScopeValues }),
		...foodDisplayColumns()
	},
	(table) => [
		uniqueIndex('user_food_display_preferences_unique').on(
			table.workosUserId,
			table.foodId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredMeasureUnitId, table.preferredMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_food_display_preferences_measure_fk'
		}),
		check(
			'user_food_display_preferences_alias_pair_check',
			nullablePair(table.preferredFoodAliasScope, table.preferredFoodAliasId)
		),
		check(
			'user_food_display_preferences_measure_pair_check',
			nullablePair(table.preferredMeasureUnitId, table.preferredMeasureBaseUnitId)
		),
		check(
			'user_food_display_preferences_alias_scope_check',
			sql`${table.preferredFoodAliasScope} IS NULL OR ${table.preferredFoodAliasScope} IN ('global', 'household', 'user')`
		)
	]
);

export const householdFoodDisplayPreferences = sqliteTable(
	'household_food_display_overrides',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		preferredFoodAliasScope: text('preferred_food_alias_scope', {
			enum: householdAliasScopeValues
		}),
		...foodDisplayColumns()
	},
	(table) => [
		uniqueIndex('household_food_display_preferences_unique').on(
			table.householdId,
			table.foodId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredMeasureUnitId, table.preferredMeasureBaseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'household_food_display_preferences_measure_fk'
		}),
		check(
			'household_food_display_preferences_alias_pair_check',
			nullablePair(table.preferredFoodAliasScope, table.preferredFoodAliasId)
		),
		check(
			'household_food_display_preferences_measure_pair_check',
			nullablePair(table.preferredMeasureUnitId, table.preferredMeasureBaseUnitId)
		),
		check(
			'household_food_display_preferences_alias_scope_check',
			sql`${table.preferredFoodAliasScope} IS NULL OR ${table.preferredFoodAliasScope} IN ('global', 'household')`
		)
	]
);

const unitDisplayColumns = () => ({
	baseUnitId: text('base_unit_id')
		.notNull()
		.references(() => units.id),
	locale: text('locale').notNull(),
	preferredUnitId: text('preferred_unit_id').notNull(),
	preferredUnitAliasId: text('preferred_unit_alias_id'),
	...mutableColumns()
});

export const userUnitDisplayPreferences = sqliteTable(
	'user_unit_display_overrides',
	{
		id: text('id').primaryKey(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		preferredUnitAliasScope: text('preferred_unit_alias_scope', { enum: aliasScopeValues }),
		...unitDisplayColumns()
	},
	(table) => [
		uniqueIndex('user_unit_display_preferences_unique').on(
			table.workosUserId,
			table.baseUnitId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredUnitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_unit_display_preferences_preferred_unit_fk'
		}),
		check(
			'user_unit_display_preferences_alias_pair_check',
			nullablePair(table.preferredUnitAliasScope, table.preferredUnitAliasId)
		),
		check(
			'user_unit_display_preferences_alias_scope_check',
			sql`${table.preferredUnitAliasScope} IS NULL OR ${table.preferredUnitAliasScope} IN ('global', 'household', 'user')`
		)
	]
);

export const householdUnitDisplayPreferences = sqliteTable(
	'household_unit_display_overrides',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		preferredUnitAliasScope: text('preferred_unit_alias_scope', {
			enum: householdAliasScopeValues
		}),
		...unitDisplayColumns()
	},
	(table) => [
		uniqueIndex('household_unit_display_preferences_unique').on(
			table.householdId,
			table.baseUnitId,
			table.locale
		),
		foreignKey({
			columns: [table.preferredUnitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'household_unit_display_preferences_preferred_unit_fk'
		}),
		check(
			'household_unit_display_preferences_alias_pair_check',
			nullablePair(table.preferredUnitAliasScope, table.preferredUnitAliasId)
		),
		check(
			'household_unit_display_preferences_alias_scope_check',
			sql`${table.preferredUnitAliasScope} IS NULL OR ${table.preferredUnitAliasScope} IN ('global', 'household')`
		)
	]
);
