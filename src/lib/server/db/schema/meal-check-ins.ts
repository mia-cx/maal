import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, id, json } from './common';
import { householdMeals } from './household-meals';
import { userRecipes } from './user-recipes';

export const mealCheckIns = sqliteTable(
	'meal_check_ins',
	{
		id: id(),
		householdMealId: text('household_meal_id').references(() => householdMeals.id, {
			onDelete: 'set null'
		}),
		userRecipeId: text('user_recipe_id').references(() => userRecipes.id, { onDelete: 'set null' }),
		plannedCookWorkosUserId: text('planned_cook_workos_user_id'),
		actualCookWorkosUserId: text('actual_cook_workos_user_id'),
		reportedByWorkosUserId: text('reported_by_workos_user_id').notNull(),
		actualMinutes: integer('actual_minutes'),
		claimedMinutes: integer('claimed_minutes'),
		cookTimeRatio: real('cook_time_ratio'),
		servingsCooked: real('servings_cooked'),
		verdict: text('verdict', { enum: ['worth_repeating', 'neutral', 'never_again'] }),
		reasonsJson: json<string[]>('reasons_json'),
		notes: text('notes'),
		createdAt: createdAt()
	},
	(table) => [
		index('meal_check_ins_household_meal_id_idx').on(table.householdMealId),
		index('meal_check_ins_user_recipe_id_idx').on(table.userRecipeId),
		index('meal_check_ins_reported_by_idx').on(table.reportedByWorkosUserId),
		index('meal_check_ins_actual_cook_idx').on(table.actualCookWorkosUserId),
		check(
			'meal_check_ins_subject_check',
			sql`${table.householdMealId} IS NOT NULL OR ${table.userRecipeId} IS NOT NULL`
		),
		check(
			'meal_check_ins_cook_time_check',
			sql`${table.actualMinutes} IS NULL OR ${table.actualCookWorkosUserId} IS NOT NULL`
		)
	]
);
