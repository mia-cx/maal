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
import { foods } from './food';
import { households } from './households';
import { units } from './units';
import { userRecipes } from './user-recipes';
import { users } from './users';

const applianceValues = [
	'oven',
	'stovetop',
	'microwave',
	'air_fryer',
	'slow_cooker',
	'rice_cooker',
	'blender',
	'food_processor',
	'grill'
] as const;

const applianceSourceValues = ['schema_org', 'instruction_heuristic', 'user'] as const;
const classificationKindValues = ['category', 'cuisine', 'keyword', 'diet'] as const;
const mediaKindValues = ['image', 'video'] as const;
const eventKindValues = ['temperature', 'duration', 'appliance', 'action'] as const;
const nutrientValues = [
	'calories',
	'carbohydrate',
	'cholesterol',
	'fat',
	'fiber',
	'protein',
	'saturated_fat',
	'serving_size',
	'sodium',
	'sugar',
	'trans_fat',
	'unsaturated_fat',
	'other'
] as const;

export const householdMeals = sqliteTable(
	'household_meals',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		imageUrl: text('image_url'),
		date: text('date'),
		time: text('time'),
		status: text('status', { enum: ['planned', 'cooked'] })
			.notNull()
			.default('planned'),
		prepTimeMinutes: integer('prep_time_minutes'),
		cookTimeMinutes: integer('cook_time_minutes'),
		totalTimeMinutes: integer('total_time_minutes'),
		yield: real('yield'),
		plannedYield: integer('planned_yield'),
		plannedCookWorkosUserId: text('planned_cook_workos_user_id').references(
			() => users.workosUserId,
			{ onDelete: 'set null' }
		),
		sortOrder: integer('sort_order'),
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
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('household_meals_household_id_idx').on(table.householdId),
		index('household_meals_household_status_idx').on(table.householdId, table.status),
		index('household_meals_household_date_time_idx').on(table.householdId, table.date, table.time),
		index('household_meals_household_floating_sort_idx').on(
			table.householdId,
			table.date,
			table.sortOrder
		),
		index('household_meals_planned_cook_idx').on(table.plannedCookWorkosUserId),
		index('household_meals_sort_order_idx').on(table.sortOrder)
	]
);

export const householdMealUserRecipes = sqliteTable(
	'household_meal_user_recipes',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
		userRecipeId: text('user_recipe_id')
			.notNull()
			.references(() => userRecipes.id),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('household_meal_user_recipes_unique').on(table.householdMealId, table.userRecipeId),
		index('household_meal_user_recipes_meal_idx').on(table.householdMealId),
		index('household_meal_user_recipes_recipe_idx').on(table.userRecipeId)
	]
);

export const householdMealIngredients = sqliteTable(
	'household_meal_ingredients',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
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
		uniqueIndex('household_meal_ingredients_meal_line_unique').on(
			table.householdMealId,
			table.lineIndex
		),
		foreignKey({
			columns: [table.baseUnitId, table.baseUnitFamilyId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'household_meal_ingredients_base_unit_family_fk'
		}),
		index('household_meal_ingredients_household_meal_id_idx').on(table.householdMealId),
		index('household_meal_ingredients_meal_food_idx').on(table.householdMealId, table.baseFoodId),
		index('household_meal_ingredients_base_food_id_idx').on(table.baseFoodId),
		index('household_meal_ingredients_base_unit_id_idx').on(table.baseUnitId),
		check(
			'household_meal_ingredients_base_unit_pair_check',
			sql`(${table.baseUnitId} IS NULL AND ${table.baseUnitFamilyId} IS NULL) OR (${table.baseUnitId} IS NOT NULL AND ${table.baseUnitFamilyId} IS NOT NULL)`
		)
	]
);

export const householdMealInstructions = sqliteTable(
	'household_meal_instructions',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
		stepIndex: integer('step_index').notNull(),
		sectionName: text('section_name'),
		text: text('text').notNull(),
		durationMinutes: integer('duration_minutes'),
		confidence: real('confidence'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('household_meal_instructions_meal_step_unique').on(
			table.householdMealId,
			table.stepIndex
		),
		index('household_meal_instructions_household_meal_id_idx').on(table.householdMealId)
	]
);

export const householdMealInstructionEvents = sqliteTable(
	'household_meal_instruction_events',
	{
		id: id(),
		householdMealInstructionId: text('household_meal_instruction_id')
			.notNull()
			.references(() => householdMealInstructions.id, { onDelete: 'cascade' }),
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
			name: 'household_meal_instruction_events_unit_base_fk'
		}),
		index('household_meal_instruction_events_instruction_idx').on(table.householdMealInstructionId),
		index('household_meal_instruction_events_kind_idx').on(table.kind),
		check(
			'household_meal_instruction_events_unit_pair_check',
			sql`(${table.unitId} IS NULL AND ${table.baseUnitId} IS NULL) OR (${table.unitId} IS NOT NULL AND ${table.baseUnitId} IS NOT NULL)`
		)
	]
);

export const householdMealApplianceRequirements = sqliteTable(
	'household_meal_appliance_requirements',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
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
		uniqueIndex('household_meal_appliance_requirements_meal_appliance_unique').on(
			table.householdMealId,
			table.appliance
		),
		index('household_meal_appliance_requirements_household_meal_id_idx').on(table.householdMealId),
		index('household_meal_appliance_requirements_appliance_idx').on(table.appliance)
	]
);

export const householdMealClassifications = sqliteTable(
	'household_meal_classifications',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: classificationKindValues }).notNull(),
		value: text('value').notNull(),
		normalizedValue: text('normalized_value').notNull(),
		schemaOrgValue: text('schema_org_value'),
		locale: text('locale'),
		confidence: real('confidence').notNull().default(1),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('household_meal_classifications_unique').on(
			table.householdMealId,
			table.kind,
			table.normalizedValue,
			table.locale
		),
		index('household_meal_classifications_meal_id_idx').on(table.householdMealId),
		index('household_meal_classifications_kind_value_idx').on(table.kind, table.normalizedValue)
	]
);

export const householdMealMedia = sqliteTable(
	'household_meal_media',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
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
		index('household_meal_media_meal_id_idx').on(table.householdMealId),
		index('household_meal_media_kind_idx').on(table.kind)
	]
);

export const householdMealNutritionFacts = sqliteTable(
	'household_meal_nutrition_facts',
	{
		id: id(),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
		nutrient: text('nutrient', { enum: nutrientValues }).notNull(),
		schemaOrgProperty: text('schema_org_property').notNull(),
		originalText: text('original_text').notNull(),
		amount: real('amount'),
		unitId: text('unit_id'),
		baseAmount: real('base_amount'),
		baseUnitId: text('base_unit_id'),
		locale: text('locale'),
		confidence: real('confidence').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('household_meal_nutrition_facts_unique').on(
			table.householdMealId,
			table.schemaOrgProperty
		),
		foreignKey({
			columns: [table.unitId, table.baseUnitId],
			foreignColumns: [units.id, units.baseUnitId],
			name: 'household_meal_nutrition_facts_unit_base_fk'
		}),
		index('household_meal_nutrition_facts_meal_id_idx').on(table.householdMealId),
		index('household_meal_nutrition_facts_nutrient_idx').on(table.nutrient),
		check(
			'household_meal_nutrition_facts_unit_pair_check',
			sql`(${table.unitId} IS NULL AND ${table.baseUnitId} IS NULL) OR (${table.unitId} IS NOT NULL AND ${table.baseUnitId} IS NOT NULL)`
		)
	]
);
