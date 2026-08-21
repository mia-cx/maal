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
import {
	confidenceRange,
	createdAt,
	enumCheck,
	instructionEventPayload,
	mutableColumns,
	nonEmptyMediaPayload,
	nonNegative,
	nullablePair,
	updatedAt
} from './common.js';
import {
	applianceSourceValues,
	applianceValues,
	classificationKindValues,
	instructionEventKindValues,
	mediaKindValues,
	nutrientValues
} from './enums.js';
import { households, users } from './identity.js';
import { foods, units } from './taxonomy.js';

export const recipes = sqliteTable(
	'recipes',
	{
		id: text('id').primaryKey(),
		ownerUserId: text('owner_user_id')
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
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
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
		...mutableColumns()
	},
	(table) => [
		index('recipes_owner_visible_idx').on(table.ownerUserId, table.deletedAt),
		index('recipes_saved_from_household_idx').on(table.savedFromHouseholdId),
		index('recipes_source_url_idx').on(table.sourceUrl),
		index('recipes_source_html_hash_idx').on(table.sourceHtmlHash),
		index('recipes_updated_idx').on(table.updatedAt),
		check('recipes_revision_positive', sql`${table.revision} > 0`),
		check('recipes_parse_confidence_range', confidenceRange(table.parseConfidence)),
		check('recipes_ingredient_confidence_range', confidenceRange(table.ingredientConfidence)),
		check('recipes_instruction_confidence_range', confidenceRange(table.instructionConfidence)),
		check('recipes_nutrition_confidence_range', confidenceRange(table.nutritionConfidence))
	]
);

export const recipeIngredients = sqliteTable(
	'recipe_ingredients',
	{
		id: text('id').primaryKey(),
		recipeId: text('recipe_id')
			.notNull()
			.references(() => recipes.id, { onDelete: 'cascade' }),
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
		uniqueIndex('recipe_ingredients_recipe_line_unique').on(table.recipeId, table.lineIndex),
		foreignKey({
			columns: [table.baseUnitId, table.baseUnitFamilyId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'recipe_ingredients_base_unit_family_fk'
		}).onDelete('set null'),
		index('recipe_ingredients_recipe_idx').on(table.recipeId),
		index('recipe_ingredients_food_idx').on(table.baseFoodId),
		check('recipe_ingredients_line_nonnegative', nonNegative(table.lineIndex)),
		check(
			'recipe_ingredients_base_unit_pair_check',
			nullablePair(table.baseUnitId, table.baseUnitFamilyId)
		),
		check('recipe_ingredients_confidence_range', confidenceRange(table.confidence))
	]
);

export const recipeInstructions = sqliteTable(
	'recipe_instructions',
	{
		id: text('id').primaryKey(),
		recipeId: text('recipe_id')
			.notNull()
			.references(() => recipes.id, { onDelete: 'cascade' }),
		stepIndex: integer('step_index').notNull(),
		sectionName: text('section_name'),
		text: text('text').notNull(),
		durationMinutes: integer('duration_minutes'),
		confidence: real('confidence'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('recipe_instructions_recipe_step_unique').on(table.recipeId, table.stepIndex),
		index('recipe_instructions_recipe_idx').on(table.recipeId),
		check('recipe_instructions_step_nonnegative', nonNegative(table.stepIndex)),
		check('recipe_instructions_confidence_range', confidenceRange(table.confidence))
	]
);

export const recipeInstructionEvents = sqliteTable(
	'recipe_instruction_events',
	{
		id: text('id').primaryKey(),
		recipeInstructionId: text('recipe_instruction_id')
			.notNull()
			.references(() => recipeInstructions.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: instructionEventKindValues }).notNull(),
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
			name: 'recipe_instruction_events_unit_base_fk'
		}).onDelete('set null'),
		index('recipe_instruction_events_instruction_idx').on(table.recipeInstructionId),
		enumCheck('recipe_instruction_events_kind_check', table.kind, instructionEventKindValues),
		check(
			'recipe_instruction_events_appliance_check',
			sql`${table.appliance} IS NULL OR ${table.appliance} IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill')`
		),
		check(
			'recipe_instruction_events_unit_pair_check',
			nullablePair(table.unitId, table.baseUnitId)
		),
		check('recipe_instruction_events_payload_check', instructionEventPayload(table)),
		check('recipe_instruction_events_confidence_range', confidenceRange(table.confidence))
	]
);

export const recipeApplianceRequirements = sqliteTable(
	'recipe_appliance_requirements',
	{
		id: text('id').primaryKey(),
		recipeId: text('recipe_id')
			.notNull()
			.references(() => recipes.id, { onDelete: 'cascade' }),
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
		uniqueIndex('recipe_appliance_requirements_unique').on(table.recipeId, table.appliance),
		enumCheck('recipe_appliance_requirements_appliance_check', table.appliance, applianceValues),
		enumCheck('recipe_appliance_requirements_source_check', table.source, applianceSourceValues),
		check('recipe_appliance_requirements_confidence_range', confidenceRange(table.confidence))
	]
);

export const recipeClassifications = sqliteTable(
	'recipe_classifications',
	{
		id: text('id').primaryKey(),
		recipeId: text('recipe_id')
			.notNull()
			.references(() => recipes.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: classificationKindValues }).notNull(),
		value: text('value').notNull(),
		normalizedValue: text('normalized_value').notNull(),
		schemaOrgValue: text('schema_org_value'),
		locale: text('locale').notNull().default('en-US'),
		confidence: real('confidence').notNull().default(1),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('recipe_classifications_unique').on(
			table.recipeId,
			table.kind,
			table.normalizedValue,
			table.locale
		),
		enumCheck('recipe_classifications_kind_check', table.kind, classificationKindValues),
		check('recipe_classifications_confidence_range', confidenceRange(table.confidence))
	]
);

export const recipeMedia = sqliteTable(
	'recipe_media',
	{
		id: text('id').primaryKey(),
		recipeId: text('recipe_id')
			.notNull()
			.references(() => recipes.id, { onDelete: 'cascade' }),
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
		uniqueIndex('recipe_media_position_unique').on(table.recipeId, table.position),
		enumCheck('recipe_media_kind_check', table.kind, mediaKindValues),
		check('recipe_media_position_nonnegative', nonNegative(table.position)),
		check('recipe_media_payload_check', nonEmptyMediaPayload(table))
	]
);

export const recipeNutritionFacts = sqliteTable(
	'recipe_nutrition_facts',
	{
		id: text('id').primaryKey(),
		recipeId: text('recipe_id')
			.notNull()
			.references(() => recipes.id, { onDelete: 'cascade' }),
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
		uniqueIndex('recipe_nutrition_facts_unique').on(table.recipeId, table.schemaOrgProperty),
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'recipe_nutrition_facts_unit_base_fk'
		}).onDelete('set null'),
		enumCheck('recipe_nutrition_facts_nutrient_check', table.nutrient, nutrientValues),
		check('recipe_nutrition_facts_unit_pair_check', nullablePair(table.unitId, table.baseUnitId)),
		check('recipe_nutrition_facts_confidence_range', confidenceRange(table.confidence))
	]
);
