// Draft Drizzle taxonomy shape for review only. This is not wired into the live schema index yet.
// Live recipe and meal ingredient tables already hold flattened source text, base units,
// display overrides, and grocery rollup ids. These tables add shared taxonomy,
// localization, aliases, and moderation on top.

import { sql } from 'drizzle-orm';
import { index, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, json, updatedAt } from '../../../src/lib/server/db/schema/common';

export const taxonomyIngredients = sqliteTable(
	'taxonomy_ingredients',
	{
		id: id(),
		canonicalKey: text('canonical_key').notNull(),
		defaultLabel: text('default_label').notNull(),
		kind: text('kind', { enum: ['ingredient', 'variant'] })
			.notNull()
			.default('ingredient'),
		parentIngredientId: text('parent_ingredient_id'),
		groceryRollupIngredientId: text('grocery_rollup_ingredient_id'),
		defaultMeasureKind: text('default_measure_kind', { enum: ['mass', 'volume', 'count'] }),
		category: text('category'),
		status: text('status', { enum: ['active', 'provisional', 'deprecated'] })
			.notNull()
			.default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('taxonomy_ingredients_canonical_key_unique').on(table.canonicalKey),
		index('taxonomy_ingredients_parent_idx').on(table.parentIngredientId),
		index('taxonomy_ingredients_rollup_idx').on(table.groceryRollupIngredientId),
		index('taxonomy_ingredients_status_idx').on(table.status)
	]
);

export const taxonomyIngredientLabels = sqliteTable(
	'taxonomy_ingredient_labels',
	{
		id: id(),
		ingredientId: text('ingredient_id').notNull(),
		locale: text('locale').notNull(),
		label: text('label').notNull(),
		normalizedLabel: text('normalized_label').notNull(),
		source: text('source', { enum: ['system', 'community', 'user_seed'] })
			.notNull()
			.default('system'),
		status: text('status', { enum: ['active', 'pending', 'rejected'] })
			.notNull()
			.default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('taxonomy_ingredient_labels_locale_label_unique').on(
			table.locale,
			table.normalizedLabel
		),
		index('taxonomy_ingredient_labels_ingredient_idx').on(table.ingredientId),
		index('taxonomy_ingredient_labels_status_idx').on(table.status)
	]
);

export const taxonomyIngredientAliases = sqliteTable(
	'taxonomy_ingredient_aliases',
	{
		id: id(),
		ingredientId: text('ingredient_id').notNull(),
		alias: text('alias').notNull(),
		normalizedAlias: text('normalized_alias').notNull(),
		locale: text('locale'),
		sourceDomain: text('source_domain'),
		confidence: real('confidence').notNull().default(0),
		status: text('status', { enum: ['active', 'pending', 'rejected'] })
			.notNull()
			.default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('taxonomy_ingredient_aliases_scope_alias_unique').on(
			table.locale,
			table.sourceDomain,
			table.normalizedAlias
		),
		index('taxonomy_ingredient_aliases_ingredient_idx').on(table.ingredientId),
		index('taxonomy_ingredient_aliases_status_idx').on(table.status)
	]
);

export const taxonomyUnits = sqliteTable(
	'taxonomy_units',
	{
		id: id(),
		canonicalKey: text('canonical_key').notNull(),
		symbol: text('symbol').notNull(),
		kind: text('kind', { enum: ['mass', 'volume', 'count'] }).notNull(),
		baseUnitKey: text('base_unit_key').notNull(),
		toBaseFactor: real('to_base_factor').notNull().default(1),
		status: text('status', { enum: ['active', 'deprecated'] })
			.notNull()
			.default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('taxonomy_units_canonical_key_unique').on(table.canonicalKey),
		uniqueIndex('taxonomy_units_symbol_unique').on(table.symbol),
		index('taxonomy_units_kind_idx').on(table.kind)
	]
);

export const taxonomyUnitLabels = sqliteTable(
	'taxonomy_unit_labels',
	{
		id: id(),
		unitId: text('unit_id').notNull(),
		locale: text('locale').notNull(),
		label: text('label').notNull(),
		normalizedLabel: text('normalized_label').notNull(),
		status: text('status', { enum: ['active', 'pending', 'rejected'] })
			.notNull()
			.default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('taxonomy_unit_labels_locale_label_unique').on(table.locale, table.normalizedLabel),
		index('taxonomy_unit_labels_unit_idx').on(table.unitId),
		index('taxonomy_unit_labels_status_idx').on(table.status)
	]
);

export const taxonomyUnitAliases = sqliteTable(
	'taxonomy_unit_aliases',
	{
		id: id(),
		unitId: text('unit_id').notNull(),
		alias: text('alias').notNull(),
		normalizedAlias: text('normalized_alias').notNull(),
		locale: text('locale'),
		status: text('status', { enum: ['active', 'pending', 'rejected'] })
			.notNull()
			.default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('taxonomy_unit_aliases_scope_alias_unique').on(table.locale, table.normalizedAlias),
		index('taxonomy_unit_aliases_unit_idx').on(table.unitId),
		index('taxonomy_unit_aliases_status_idx').on(table.status)
	]
);

export const householdIngredientDisplayOverrides = sqliteTable(
	'household_ingredient_display_overrides',
	{
		id: id(),
		householdId: text('household_id').notNull(),
		ingredientId: text('ingredient_id').notNull(),
		displayLabel: text('display_label'),
		preferredUnitId: text('preferred_unit_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('household_ingredient_display_overrides_unique').on(
			table.householdId,
			table.ingredientId
		),
		index('household_ingredient_display_overrides_household_idx').on(table.householdId)
	]
);

export const userIngredientDisplayOverrides = sqliteTable(
	'user_ingredient_display_overrides',
	{
		id: id(),
		workosUserId: text('workos_user_id').notNull(),
		ingredientId: text('ingredient_id').notNull(),
		displayLabel: text('display_label'),
		preferredUnitId: text('preferred_unit_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_ingredient_display_overrides_unique').on(
			table.workosUserId,
			table.ingredientId
		),
		index('user_ingredient_display_overrides_user_idx').on(table.workosUserId)
	]
);

export const taxonomyProposals = sqliteTable(
	'taxonomy_proposals',
	{
		id: id(),
		type: text('type', {
			enum: [
				'ingredient_alias',
				'ingredient_label',
				'ingredient_variant',
				'new_ingredient',
				'unit_alias',
				'unit_label',
				'new_unit'
			]
		}).notNull(),
		status: text('status', { enum: ['pending', 'approved', 'rejected', 'merged'] })
			.notNull()
			.default('pending'),
		createdByWorkosUserId: text('created_by_workos_user_id').notNull(),
		locale: text('locale'),
		sourceDomain: text('source_domain'),
		payloadJson: json<Record<string, unknown>>('payload_json')
			.notNull()
			.default(sql`'{}'`),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('taxonomy_proposals_status_idx').on(table.status),
		index('taxonomy_proposals_type_idx').on(table.type),
		index('taxonomy_proposals_user_idx').on(table.createdByWorkosUserId)
	]
);

// Live sidecar columns on user_recipe_ingredients and household_meal_ingredients:
// - original_text: full raw source line, e.g. "2 Tbsp wild rocket"
// - source_amount_text: raw amount/unit text, e.g. "2 Tbsp"
// - source_ingredient_label: raw source label, e.g. "wild rocket"
// - base_quantity: canonical numeric quantity normalized where possible
// - base_unit: canonical unit key. Mass normalizes to g, volume to ml, count/package units
//   keep their canonical key (each, clove, can, bunch, package, etc.) because they are
//   not mutually convertible without ingredient/package metadata.
// - food_entity_id: resolved taxonomy ingredient or variant
// - grocery_rollup_food_entity_id: merge target for grocery lists
// - display_label_override: per-line label override
// - display_unit_override: per-line unit override
