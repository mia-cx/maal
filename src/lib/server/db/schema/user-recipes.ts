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
import { applianceValues } from '../../../domain/household/appliances';
import { confidenceRange, instructionEventPayload, nonEmptyMediaPayload } from './checks';
import { createdAt, id, updatedAt } from './common';
import { foods } from './food';
import { households } from './households';
import { units } from './units';
import { users } from './users';

import {
	applianceSourceValues,
	classificationKindValues,
	eventKindValues,
	mediaKindValues,
	nutrientValues
} from './recipe-taxonomy';

export const userRecipes = sqliteTable(
	'user_recipes',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		savedFromHouseholdId: text('saved_from_household_id').references(() => households.householdId, {
			onDelete: 'set null'
		}),
		title: text('title').notNull(),
		description: text('description'),
		imageUrl: text('image_url'),
		prepTimeMinutes: integer('prep_time_minutes'),
		cookTimeMinutes: integer('cook_time_minutes'),
		totalTimeMinutes: integer('total_time_minutes'),
		yield: real('yield'),
		sourceYieldText: text('source_yield_text'),
		sourceDatePublished: text('source_date_published'),
		sourceDateModified: text('source_date_modified'),
		sourceLanguage: text('source_language'),
		sourceUrl: text('source_url'),
		sourceSiteName: text('source_site_name'),
		sourceAuthorName: text('source_author_name'),
		sourcePublisherName: text('source_publisher_name'),
		sourceIsBasedOnUrl: text('source_is_based_on_url'),
		sourceImportedAt: text('source_imported_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		sourceHtmlHash: text('source_html_hash'),
		sourceRatingValue: real('source_rating_value'),
		sourceRatingCount: integer('source_rating_count'),
		sourceReviewCount: integer('source_review_count'),
		sourceClaimedMinutes: integer('source_claimed_minutes'),
		parseConfidence: real('parse_confidence'),
		ingredientConfidence: real('ingredient_confidence'),
		instructionConfidence: real('instruction_confidence'),
		nutritionConfidence: real('nutrition_confidence'),
		userNotes: text('user_notes'),
		deletedAt: text('deleted_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('user_recipes_workos_user_id_idx').on(table.workosUserId),
		index('user_recipes_user_visible_idx').on(table.workosUserId, table.deletedAt),
		index('user_recipes_saved_from_household_id_idx').on(table.savedFromHouseholdId),
		index('user_recipes_source_url_idx').on(table.sourceUrl),
		index('user_recipes_source_html_hash_idx').on(table.sourceHtmlHash),
		index('user_recipes_deleted_at_idx').on(table.deletedAt),
		check('user_recipes_parse_confidence_range', confidenceRange(table.parseConfidence)),
		check('user_recipes_ingredient_confidence_range', confidenceRange(table.ingredientConfidence)),
		check(
			'user_recipes_instruction_confidence_range',
			confidenceRange(table.instructionConfidence)
		),
		check('user_recipes_nutrition_confidence_range', confidenceRange(table.nutritionConfidence))
	]
);

export const userRecipeIngredients = sqliteTable(
	'user_recipe_ingredients',
	{
		id: id(),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id, { onDelete: 'cascade' }),
		lineIndex: integer('line_index').notNull(),
		originalText: text('original_text').notNull(),
		sourceAmountText: text('source_amount_text'),
		sourceQuantity: real('source_quantity'),
		sourceUnitLabel: text('source_unit_label'),
		sourceFoodLabel: text('source_food_label').notNull(),
		baseFoodId: text('base_food_id').references(() => foods.id, { onDelete: 'set null' }),
		baseQuantity: real('base_quantity'),
		baseUnitId: text('base_unit_id'),
		baseUnitFamilyId: text('base_unit_family_id'),
		optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
		confidence: real('confidence').notNull().default(0),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('user_recipe_ingredients_recipe_line_unique').on(
			table.userRecipeId,
			table.lineIndex
		),
		foreignKey({
			columns: [table.baseUnitId, table.baseUnitFamilyId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_recipe_ingredients_base_unit_family_fk'
		}),
		index('user_recipe_ingredients_user_recipe_id_idx').on(table.userRecipeId),
		index('user_recipe_ingredients_recipe_food_idx').on(table.userRecipeId, table.baseFoodId),
		index('user_recipe_ingredients_base_food_id_idx').on(table.baseFoodId),
		index('user_recipe_ingredients_base_unit_id_idx').on(table.baseUnitId),
		check(
			'user_recipe_ingredients_base_unit_pair_check',
			sql`(${table.baseUnitId} IS NULL AND ${table.baseUnitFamilyId} IS NULL) OR (${table.baseUnitId} IS NOT NULL AND ${table.baseUnitFamilyId} IS NOT NULL)`
		),
		check('user_recipe_ingredients_confidence_range', confidenceRange(table.confidence))
	]
);

export const userRecipeInstructions = sqliteTable(
	'user_recipe_instructions',
	{
		id: id(),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id, { onDelete: 'cascade' }),
		stepIndex: integer('step_index').notNull(),
		sectionName: text('section_name'),
		text: text('text').notNull(),
		durationMinutes: integer('duration_minutes'),
		confidence: real('confidence'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_recipe_instructions_recipe_step_unique').on(
			table.userRecipeId,
			table.stepIndex
		),
		index('user_recipe_instructions_user_recipe_id_idx').on(table.userRecipeId),
		check('user_recipe_instructions_confidence_range', confidenceRange(table.confidence))
	]
);

export const userRecipeInstructionEvents = sqliteTable(
	'user_recipe_instruction_events',
	{
		id: id(),
		userRecipeInstructionId: text('user_recipe_instruction_id')
			.notNull()
			.references(() => userRecipeInstructions.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: eventKindValues }).notNull(),
		appliance: text('appliance', { enum: applianceValues }),
		sourceText: text('source_text').notNull(),
		value: real('value'),
		unitId: text('unit_id'),
		baseValue: real('base_value'),
		baseUnitId: text('base_unit_id'),
		confidence: real('confidence').notNull().default(0),
		createdAt: createdAt()
	},
	(table) => [
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_recipe_instruction_events_unit_base_fk'
		}),
		index('user_recipe_instruction_events_instruction_idx').on(table.userRecipeInstructionId),
		index('user_recipe_instruction_events_kind_idx').on(table.kind),
		check(
			'user_recipe_instruction_events_unit_pair_check',
			sql`(${table.unitId} IS NULL AND ${table.baseUnitId} IS NULL) OR (${table.unitId} IS NOT NULL AND ${table.baseUnitId} IS NOT NULL)`
		),
		check('user_recipe_instruction_events_payload_check', instructionEventPayload(table)),
		check('user_recipe_instruction_events_confidence_range', confidenceRange(table.confidence))
	]
);

export const userRecipeApplianceRequirements = sqliteTable(
	'user_recipe_appliance_requirements',
	{
		id: id(),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id, { onDelete: 'cascade' }),
		appliance: text('appliance', { enum: applianceValues }).notNull(),
		required: integer('required', { mode: 'boolean' }).notNull().default(true),
		source: text('source', { enum: applianceSourceValues })
			.notNull()
			.default('instruction_heuristic'),
		confidence: real('confidence').notNull().default(0),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_recipe_appliance_requirements_recipe_appliance_unique').on(
			table.userRecipeId,
			table.appliance
		),
		index('user_recipe_appliance_requirements_user_recipe_id_idx').on(table.userRecipeId),
		index('user_recipe_appliance_requirements_appliance_idx').on(table.appliance),
		check('user_recipe_appliance_requirements_confidence_range', confidenceRange(table.confidence))
	]
);

export const userRecipeClassifications = sqliteTable(
	'user_recipe_classifications',
	{
		id: id(),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: classificationKindValues }).notNull(),
		value: text('value').notNull(),
		normalizedValue: text('normalized_value').notNull(),
		schemaOrgValue: text('schema_org_value'),
		locale: text('locale').notNull().default('en-US'),
		confidence: real('confidence').notNull().default(1),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('user_recipe_classifications_unique').on(
			table.userRecipeId,
			table.kind,
			table.normalizedValue,
			table.locale
		),
		index('user_recipe_classifications_recipe_id_idx').on(table.userRecipeId),
		index('user_recipe_classifications_kind_value_idx').on(table.kind, table.normalizedValue),
		check('user_recipe_classifications_confidence_range', confidenceRange(table.confidence))
	]
);

export const userRecipeMedia = sqliteTable(
	'user_recipe_media',
	{
		id: id(),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: mediaKindValues }).notNull(),
		position: integer('position').notNull().default(0),
		url: text('url'),
		contentUrl: text('content_url'),
		embedUrl: text('embed_url'),
		thumbnailUrl: text('thumbnail_url'),
		name: text('name'),
		caption: text('caption'),
		createdAt: createdAt()
	},
	(table) => [
		index('user_recipe_media_recipe_id_idx').on(table.userRecipeId),
		index('user_recipe_media_kind_idx').on(table.kind),
		check('user_recipe_media_payload_check', nonEmptyMediaPayload(table))
	]
);

export const userRecipeNutritionFacts = sqliteTable(
	'user_recipe_nutrition_facts',
	{
		id: id(),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id, { onDelete: 'cascade' }),
		nutrient: text('nutrient', { enum: nutrientValues }).notNull(),
		schemaOrgProperty: text('schema_org_property').notNull(),
		originalText: text('original_text').notNull(),
		amount: real('amount'),
		unitId: text('unit_id'),
		baseAmount: real('base_amount'),
		baseUnitId: text('base_unit_id'),
		locale: text('locale').notNull().default('en-US'),
		confidence: real('confidence').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('user_recipe_nutrition_facts_unique').on(
			table.userRecipeId,
			table.schemaOrgProperty
		),
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'user_recipe_nutrition_facts_unit_base_fk'
		}),
		index('user_recipe_nutrition_facts_recipe_id_idx').on(table.userRecipeId),
		index('user_recipe_nutrition_facts_nutrient_idx').on(table.nutrient),
		check(
			'user_recipe_nutrition_facts_unit_pair_check',
			sql`(${table.unitId} IS NULL AND ${table.baseUnitId} IS NULL) OR (${table.unitId} IS NOT NULL AND ${table.baseUnitId} IS NOT NULL)`
		),
		check('user_recipe_nutrition_facts_confidence_range', confidenceRange(table.confidence))
	]
);
