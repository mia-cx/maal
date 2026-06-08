import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, json, updatedAt } from './common';

export const foodEntities = sqliteTable(
	'food_entities',
	{
		id: id(),
		canonicalName: text('canonical_name').notNull(),
		type: text('type', {
			enum: ['ingredient', 'ingredient_group', 'cuisine', 'texture', 'tag']
		}).notNull(),
		parentId: text('parent_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('food_entities_canonical_name_unique').on(table.canonicalName),
		index('food_entities_parent_id_idx').on(table.parentId)
	]
);

export const foodEntityAliases = sqliteTable(
	'food_entity_aliases',
	{
		id: id(),
		foodEntityId: text('food_entity_id')
			.notNull()
			.references(() => foodEntities.id, { onDelete: 'cascade' }),
		alias: text('alias').notNull(),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('food_entity_aliases_alias_unique').on(table.alias),
		index('food_entity_aliases_food_entity_id_idx').on(table.foodEntityId)
	]
);

export const hardFoodRules = sqliteTable(
	'hard_food_rules',
	{
		id: id(),
		workosUserId: text('workos_user_id').notNull(),
		type: text('type', { enum: ['allergy', 'diet_constraint'] }).notNull(),
		foodEntityId: text('food_entity_id').references(() => foodEntities.id, {
			onDelete: 'set null'
		}),
		rawSubject: text('raw_subject'),
		severity: text('severity', { enum: ['block', 'warn'] })
			.notNull()
			.default('block'),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('hard_food_rules_workos_user_id_idx').on(table.workosUserId),
		index('hard_food_rules_food_entity_id_idx').on(table.foodEntityId),
		check(
			'hard_food_rules_subject_check',
			sql`${table.foodEntityId} IS NOT NULL OR ${table.rawSubject} IS NOT NULL`
		)
	]
);

export const tastePreferences = sqliteTable(
	'taste_preferences',
	{
		id: id(),
		workosUserId: text('workos_user_id').notNull(),
		foodEntityId: text('food_entity_id').references(() => foodEntities.id, {
			onDelete: 'set null'
		}),
		rawSubject: text('raw_subject'),
		subjectType: text('subject_type', {
			enum: ['ingredient', 'recipe', 'cuisine', 'texture', 'tag']
		}).notNull(),
		rating: text('rating', {
			enum: ['favourite', 'like', 'mostly_indifferent', 'hate']
		}).notNull(),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('taste_preferences_workos_user_id_idx').on(table.workosUserId),
		index('taste_preferences_food_entity_id_idx').on(table.foodEntityId),
		check(
			'taste_preferences_subject_check',
			sql`${table.foodEntityId} IS NOT NULL OR ${table.rawSubject} IS NOT NULL`
		)
	]
);

export const pantryStaples = sqliteTable(
	'pantry_staples',
	{
		id: id(),
		householdId: text('household_id').notNull(),
		foodEntityId: text('food_entity_id').references(() => foodEntities.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		aliasesJson: json<string[]>('aliases_json')
			.notNull()
			.default(sql`'[]'`),
		category: text('category', {
			enum: [
				'produce',
				'meat_seafood',
				'dairy_eggs',
				'bakery',
				'pantry',
				'spices',
				'oil_vinegar',
				'frozen',
				'household',
				'other'
			]
		}),
		defaultUnit: text('default_unit'),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('pantry_staples_household_id_idx').on(table.householdId),
		index('pantry_staples_food_entity_id_idx').on(table.foodEntityId)
	]
);
