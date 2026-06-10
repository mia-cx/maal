import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { createdAt, id, json, type JsonObject, updatedAt } from './common';
import { foodEntities } from './food';
import { userRecipes } from './user-recipes';

export const householdMeals = sqliteTable(
	'household_meals',
	{
		id: id(),
		householdId: text('household_id').notNull(),
		userRecipeId: text('user_recipe_id').references(() => userRecipes.id, { onDelete: 'set null' }),
		recipeSnapshotJson: json<JsonObject>('recipe_snapshot_json'),
		recipeSourceJson: json<JsonObject>('recipe_source_json'),
		recipeMetadataJson: json<JsonObject>('recipe_metadata_json'),
		promotedToUserRecipeId: text('promoted_to_user_recipe_id').references(() => userRecipes.id, {
			onDelete: 'set null'
		}),
		includeInGroceryList: integer('include_in_grocery_list', { mode: 'boolean' })
			.notNull()
			.default(false),
		scheduledFor: text('scheduled_for'),
		date: text('date'),
		slot: text('slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack', 'other'] }),
		status: text('status', {
			enum: ['planned', 'cooked', 'skipped', 'postponed', 'replaced', 'archived']
		})
			.notNull()
			.default('planned'),
		servingsPlanned: real('servings_planned').notNull().default(1),
		servingsCooked: real('servings_cooked'),
		plannedCookWorkosUserId: text('planned_cook_workos_user_id'),
		ingredientPurchaseState: text('ingredient_purchase_state', {
			enum: ['none_needed', 'not_purchased', 'partially_purchased', 'ready', 'unknown']
		})
			.notNull()
			.default('unknown'),
		sortOrder: integer('sort_order'),
		lastConsideredAt: text('last_considered_at'),
		replacedByHouseholdMealId: text('replaced_by_household_meal_id'),
		replacementKind: text('replacement_kind', {
			enum: ['household_meal', 'takeout', 'external_meal']
		}),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('household_meals_household_id_idx').on(table.householdId),
		index('household_meals_user_recipe_id_idx').on(table.userRecipeId),
		index('household_meals_status_idx').on(table.status),
		index('household_meals_scheduled_for_idx').on(table.scheduledFor),
		index('household_meals_date_idx').on(table.date),
		index('household_meals_include_in_grocery_list_idx').on(table.includeInGroceryList),
		check(
			'household_meals_recipe_source_check',
			sql`${table.userRecipeId} IS NOT NULL OR ${table.recipeSnapshotJson} IS NOT NULL`
		)
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
		uniqueIndex('household_meal_ingredients_meal_line_unique').on(
			table.householdMealId,
			table.lineIndex
		),
		index('household_meal_ingredients_household_meal_id_idx').on(table.householdMealId),
		index('household_meal_ingredients_food_entity_id_idx').on(table.foodEntityId)
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
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('household_meal_instructions_meal_step_unique').on(
			table.householdMealId,
			table.stepIndex
		),
		index('household_meal_instructions_household_meal_id_idx').on(table.householdMealId)
	]
);

export const householdMealNutrition = sqliteTable('household_meal_nutrition', {
	householdMealId: text('household_meal_id')
		.primaryKey()
		.references(() => householdMeals.id, { onDelete: 'cascade' }),
	calories: real('calories'),
	proteinGrams: real('protein_grams'),
	carbsGrams: real('carbs_grams'),
	fatGrams: real('fat_grams'),
	servingSize: text('serving_size'),
	confidence: real('confidence'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});
