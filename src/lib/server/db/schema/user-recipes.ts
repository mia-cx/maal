import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, json, type JsonArray, type JsonObject, updatedAt } from './common';
import { foodEntities } from './food';

export const userRecipes = sqliteTable(
	'user_recipes',
	{
		id: id(),
		workosUserId: text('workos_user_id').notNull(),
		savedFromHouseholdId: text('saved_from_household_id'),
		schemaOrgRecipeJson: json<JsonObject>('schema_org_recipe_json').notNull(),
		rawJsonLd: json<JsonObject | JsonArray>('raw_json_ld'),
		sourceUrl: text('source_url'),
		sourceSiteName: text('source_site_name'),
		sourceAuthorName: text('source_author_name'),
		sourceImportedAt: text('source_imported_at')
			.notNull()
			.default(sql`CURRENT_TIMESTAMP`),
		sourceHtmlHash: text('source_html_hash'),
		familiarity: text('familiarity', {
			enum: ['new', 'exploration', 'safe', 'survival', 'wildcard']
		})
			.notNull()
			.default('new'),
		knownStatus: text('known_status', { enum: ['safe', 'neutral', 'avoid'] }),
		latestVerdict: text('latest_verdict', {
			enum: ['worth_repeating', 'neutral', 'never_again']
		}),
		timesCooked: integer('times_cooked').notNull().default(0),
		lastCookedAt: text('last_cooked_at'),
		averageActualMinutes: real('average_actual_minutes'),
		sourceClaimedMinutes: integer('source_claimed_minutes'),
		parseConfidence: real('parse_confidence'),
		ingredientConfidence: real('ingredient_confidence'),
		instructionConfidence: real('instruction_confidence'),
		nutritionConfidence: real('nutrition_confidence'),
		timeRealismConfidence: real('time_realism_confidence'),
		userNotes: text('user_notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('user_recipes_workos_user_id_idx').on(table.workosUserId),
		index('user_recipes_saved_from_household_id_idx').on(table.savedFromHouseholdId),
		index('user_recipes_known_status_idx').on(table.knownStatus),
		index('user_recipes_familiarity_idx').on(table.familiarity)
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
		parsedName: text('parsed_name'),
		foodEntityId: text('food_entity_id').references(() => foodEntities.id, {
			onDelete: 'set null'
		}),
		quantity: real('quantity'),
		unit: text('unit'),
		category: text('category'),
		optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
		confidence: real('confidence').notNull().default(0),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('user_recipe_ingredients_recipe_line_unique').on(
			table.userRecipeId,
			table.lineIndex
		),
		index('user_recipe_ingredients_user_recipe_id_idx').on(table.userRecipeId),
		index('user_recipe_ingredients_food_entity_id_idx').on(table.foodEntityId)
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
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('user_recipe_instructions_recipe_step_unique').on(
			table.userRecipeId,
			table.stepIndex
		),
		index('user_recipe_instructions_user_recipe_id_idx').on(table.userRecipeId)
	]
);

export const userRecipeNutrition = sqliteTable('user_recipe_nutrition', {
	userRecipeId: text('user_recipe_id')
		.primaryKey()
		.references(() => userRecipes.id, { onDelete: 'cascade' }),
	calories: real('calories'),
	proteinGrams: real('protein_grams'),
	carbsGrams: real('carbs_grams'),
	fatGrams: real('fat_grams'),
	servingSize: text('serving_size'),
	confidence: real('confidence'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});
