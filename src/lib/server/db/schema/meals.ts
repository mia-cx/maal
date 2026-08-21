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
	nullablePositive,
	updatedAt
} from './common.js';
import {
	applianceSourceValues,
	applianceValues,
	classificationKindValues,
	instructionEventKindValues,
	mealStatusValues,
	mealVerdictValues,
	mediaKindValues,
	nutrientValues
} from './enums.js';
import { households, users } from './identity.js';
import { recipes } from './recipes.js';
import { foods, units } from './taxonomy.js';

export const meals = sqliteTable(
	'meals',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		sourceRecipeId: text('source_recipe_id').references(() => recipes.id, {
			onDelete: 'set null'
		}),
		title: text('title').notNull(),
		description: text('description'),
		imageUrl: text('image_url'),
		date: text('date'),
		time: text('time'),
		sortOrder: integer('sort_order'),
		plannedCookUserId: text('planned_cook_user_id').references(() => users.workosUserId, {
			onDelete: 'set null'
		}),
		yield: real('yield'),
		plannedYield: integer('planned_yield'),
		status: text('status', { enum: mealStatusValues }).notNull().default('planned'),
		prepTimeMinutes: integer('prep_time_minutes'),
		cookTimeMinutes: integer('cook_time_minutes'),
		totalTimeMinutes: integer('total_time_minutes'),
		sourceYieldText: text('source_yield_text'),
		sourceDatePublished: text('source_date_published'),
		sourceDateModified: text('source_date_modified'),
		sourceLanguage: text('source_language'),
		sourceUrl: text('source_url'),
		sourceSiteName: text('source_site_name'),
		sourceAuthorName: text('source_author_name'),
		sourcePublisherName: text('source_publisher_name'),
		sourceIsBasedOnUrl: text('source_is_based_on_url'),
		sourceImportedAt: text('source_imported_at'),
		sourceHtmlHash: text('source_html_hash'),
		sourceRatingValue: real('source_rating_value'),
		sourceRatingCount: integer('source_rating_count'),
		sourceReviewCount: integer('source_review_count'),
		sourceClaimedMinutes: integer('source_claimed_minutes'),
		parseConfidence: real('parse_confidence'),
		ingredientConfidence: real('ingredient_confidence'),
		instructionConfidence: real('instruction_confidence'),
		nutritionConfidence: real('nutrition_confidence'),
		notes: text('notes'),
		...mutableColumns()
	},
	(table) => [
		index('meals_household_date_sort_idx').on(table.householdId, table.date, table.sortOrder),
		index('meals_household_status_idx').on(table.householdId, table.status),
		index('meals_source_recipe_idx').on(table.sourceRecipeId),
		index('meals_planned_cook_idx').on(table.plannedCookUserId),
		index('meals_updated_idx').on(table.updatedAt),
		enumCheck('meals_status_check', table.status, mealStatusValues),
		check('meals_revision_positive', sql`${table.revision} > 0`),
		check(
			'meals_sort_order_nonnegative',
			sql`${table.sortOrder} IS NULL OR ${table.sortOrder} >= 0`
		),
		check(
			'meals_planned_yield_positive',
			sql`${table.plannedYield} IS NULL OR ${table.plannedYield} > 0`
		),
		check('meals_parse_confidence_range', confidenceRange(table.parseConfidence)),
		check('meals_ingredient_confidence_range', confidenceRange(table.ingredientConfidence)),
		check('meals_instruction_confidence_range', confidenceRange(table.instructionConfidence)),
		check('meals_nutrition_confidence_range', confidenceRange(table.nutritionConfidence))
	]
);

export const mealIngredients = sqliteTable(
	'meal_ingredients',
	{
		id: text('id').primaryKey(),
		mealId: text('meal_id')
			.notNull()
			.references(() => meals.id, { onDelete: 'cascade' }),
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
		uniqueIndex('meal_ingredients_meal_line_unique').on(table.mealId, table.lineIndex),
		foreignKey({
			columns: [table.baseUnitId, table.baseUnitFamilyId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'meal_ingredients_base_unit_family_fk'
		}).onDelete('set null'),
		index('meal_ingredients_meal_idx').on(table.mealId),
		check('meal_ingredients_line_nonnegative', nonNegative(table.lineIndex)),
		check(
			'meal_ingredients_base_unit_pair_check',
			nullablePair(table.baseUnitId, table.baseUnitFamilyId)
		),
		check('meal_ingredients_confidence_range', confidenceRange(table.confidence))
	]
);

export const mealInstructions = sqliteTable(
	'meal_instructions',
	{
		id: text('id').primaryKey(),
		mealId: text('meal_id')
			.notNull()
			.references(() => meals.id, { onDelete: 'cascade' }),
		stepIndex: integer('step_index').notNull(),
		sectionName: text('section_name'),
		text: text('text').notNull(),
		durationMinutes: integer('duration_minutes'),
		confidence: real('confidence'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('meal_instructions_meal_step_unique').on(table.mealId, table.stepIndex),
		check('meal_instructions_step_nonnegative', nonNegative(table.stepIndex)),
		check('meal_instructions_confidence_range', confidenceRange(table.confidence))
	]
);

export const mealInstructionEvents = sqliteTable(
	'meal_instruction_events',
	{
		id: text('id').primaryKey(),
		mealInstructionId: text('meal_instruction_id')
			.notNull()
			.references(() => mealInstructions.id, { onDelete: 'cascade' }),
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
			name: 'meal_instruction_events_unit_base_fk'
		}).onDelete('set null'),
		enumCheck('meal_instruction_events_kind_check', table.kind, instructionEventKindValues),
		check(
			'meal_instruction_events_appliance_check',
			sql`${table.appliance} IS NULL OR ${table.appliance} IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill')`
		),
		check('meal_instruction_events_unit_pair_check', nullablePair(table.unitId, table.baseUnitId)),
		check('meal_instruction_events_payload_check', instructionEventPayload(table)),
		check('meal_instruction_events_confidence_range', confidenceRange(table.confidence))
	]
);

export const mealApplianceRequirements = sqliteTable(
	'meal_appliance_requirements',
	{
		id: text('id').primaryKey(),
		mealId: text('meal_id')
			.notNull()
			.references(() => meals.id, { onDelete: 'cascade' }),
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
		uniqueIndex('meal_appliance_requirements_unique').on(table.mealId, table.appliance),
		enumCheck('meal_appliance_requirements_appliance_check', table.appliance, applianceValues),
		enumCheck('meal_appliance_requirements_source_check', table.source, applianceSourceValues),
		check('meal_appliance_requirements_confidence_range', confidenceRange(table.confidence))
	]
);

export const mealClassifications = sqliteTable(
	'meal_classifications',
	{
		id: text('id').primaryKey(),
		mealId: text('meal_id')
			.notNull()
			.references(() => meals.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: classificationKindValues }).notNull(),
		value: text('value').notNull(),
		normalizedValue: text('normalized_value').notNull(),
		schemaOrgValue: text('schema_org_value'),
		locale: text('locale').notNull().default('en-US'),
		confidence: real('confidence').notNull().default(1),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('meal_classifications_unique').on(
			table.mealId,
			table.kind,
			table.normalizedValue,
			table.locale
		),
		enumCheck('meal_classifications_kind_check', table.kind, classificationKindValues),
		check('meal_classifications_confidence_range', confidenceRange(table.confidence))
	]
);

export const mealMedia = sqliteTable(
	'meal_media',
	{
		id: text('id').primaryKey(),
		mealId: text('meal_id')
			.notNull()
			.references(() => meals.id, { onDelete: 'cascade' }),
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
		uniqueIndex('meal_media_position_unique').on(table.mealId, table.position),
		enumCheck('meal_media_kind_check', table.kind, mediaKindValues),
		check('meal_media_position_nonnegative', nonNegative(table.position)),
		check('meal_media_payload_check', nonEmptyMediaPayload(table))
	]
);

export const mealNutritionFacts = sqliteTable(
	'meal_nutrition_facts',
	{
		id: text('id').primaryKey(),
		mealId: text('meal_id')
			.notNull()
			.references(() => meals.id, { onDelete: 'cascade' }),
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
		uniqueIndex('meal_nutrition_facts_unique').on(table.mealId, table.schemaOrgProperty),
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'meal_nutrition_facts_unit_base_fk'
		}).onDelete('set null'),
		enumCheck('meal_nutrition_facts_nutrient_check', table.nutrient, nutrientValues),
		check('meal_nutrition_facts_unit_pair_check', nullablePair(table.unitId, table.baseUnitId)),
		check('meal_nutrition_facts_confidence_range', confidenceRange(table.confidence))
	]
);

export const mealCheckIns = sqliteTable(
	'meal_check_ins',
	{
		id: text('id').primaryKey(),
		reporterUserId: text('reporter_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		mealId: text('meal_id').references(() => meals.id, { onDelete: 'set null' }),
		cookTimeMinutes: integer('cook_time_minutes'),
		verdict: text('verdict', { enum: mealVerdictValues }).notNull(),
		reason: text('reason'),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('meal_check_ins_meal_reporter_unique').on(table.mealId, table.reporterUserId),
		index('meal_check_ins_reporter_idx').on(table.reporterUserId),
		index('meal_check_ins_deleted_idx').on(table.deletedAt),
		enumCheck('meal_check_ins_verdict_check', table.verdict, mealVerdictValues),
		check('meal_check_ins_cook_time_positive', nullablePositive(table.cookTimeMinutes)),
		check('meal_check_ins_revision_positive', sql`${table.revision} > 0`)
	]
);
