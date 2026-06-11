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
import { createdAt, id, updatedAt } from './common';
import { households } from './households';
import { users } from './users';

const adoptionStatusValues = ['pending_review', 'accepted', 'rejected'] as const;

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
		id: id(),
		unitId: text('unit_id').notNull(),
		baseUnitId: text('base_unit_id').notNull(),
		alias: text('alias').notNull(),
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
		index('unit_aliases_unit_id_idx').on(table.unitId),
		index('unit_aliases_base_unit_locale_idx').on(table.baseUnitId, table.locale),
		index('unit_aliases_locale_alias_idx').on(table.locale, table.alias),
		index('unit_aliases_import_lookup_idx').on(table.sourceDomain, table.locale, table.alias),
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
	locale: text('locale').notNull(),
	sourceDomain: text('source_domain'),
	adoptionStatus: text('adoption_status', { enum: adoptionStatusValues })
		.notNull()
		.default('pending_review')
});

export const unitUserAliases = sqliteTable(
	'unit_user_aliases',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedUnitAliasColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'unit_user_aliases_unit_base_fk'
		}).onDelete('cascade'),
		index('unit_user_aliases_user_idx').on(table.workosUserId),
		index('unit_user_aliases_unit_idx').on(table.unitId),
		index('unit_user_aliases_lookup_idx').on(table.workosUserId, table.locale, table.alias),
		index('unit_user_aliases_adoption_idx').on(table.adoptionStatus)
	]
);

export const unitHouseholdAliases = sqliteTable(
	'unit_household_aliases',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedUnitAliasColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'unit_household_aliases_unit_base_fk'
		}).onDelete('cascade'),
		index('unit_household_aliases_household_idx').on(table.householdId),
		index('unit_household_aliases_unit_idx').on(table.unitId),
		index('unit_household_aliases_lookup_idx').on(table.householdId, table.locale, table.alias),
		index('unit_household_aliases_adoption_idx').on(table.adoptionStatus)
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
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		...scopedUnitEntryColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('unit_user_entries_label_unique').on(table.workosUserId, table.canonicalLabel),
		index('unit_user_entries_user_idx').on(table.workosUserId),
		index('unit_user_entries_base_unit_idx').on(table.baseUnitId),
		index('unit_user_entries_adoption_idx').on(table.adoptionStatus)
	]
);

export const unitHouseholdEntries = sqliteTable(
	'unit_household_entries',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		...scopedUnitEntryColumns(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('unit_household_entries_label_unique').on(table.householdId, table.canonicalLabel),
		index('unit_household_entries_household_idx').on(table.householdId),
		index('unit_household_entries_base_unit_idx').on(table.baseUnitId),
		index('unit_household_entries_adoption_idx').on(table.adoptionStatus)
	]
);
