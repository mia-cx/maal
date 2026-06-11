import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id, updatedAt } from './common';
import { householdMeals } from './household-meals';
import { users } from './users';

export const mealCheckIns = sqliteTable(
	'meal_check_ins',
	{
		id: id(),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		householdMealId: text('household_meal_id')
			.notNull()
			.references(() => householdMeals.id, { onDelete: 'cascade' }),
		cookTime: integer('cook_time'),
		verdict: text('verdict', { enum: ['repeat', 'neutral', 'avoid'] }).notNull(),
		reason: text('reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('meal_check_ins_meal_user_unique').on(table.householdMealId, table.workosUserId),
		index('meal_check_ins_household_meal_id_idx').on(table.householdMealId),
		index('meal_check_ins_workos_user_id_idx').on(table.workosUserId),
		index('meal_check_ins_user_verdict_idx').on(table.workosUserId, table.verdict),
		index('meal_check_ins_verdict_idx').on(table.verdict),
		check(
			'meal_check_ins_cook_time_positive_check',
			sql`${table.cookTime} IS NULL OR ${table.cookTime} > 0`
		)
	]
);
