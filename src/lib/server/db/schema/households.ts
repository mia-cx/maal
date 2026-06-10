import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, updatedAt } from './common';

export const householdProfiles = sqliteTable('household_profiles', {
	householdId: text('household_id').primaryKey(),
	defaultServings: integer('default_servings').notNull().default(1),
	defaultCalendarDurationDays: integer('default_calendar_duration_days').notNull().default(7),
	defaultCalendarAnchor: text('default_calendar_anchor', {
		enum: ['today', 'week_start', 'month_start']
	})
		.notNull()
		.default('today'),
	preferredDinnerTime: text('preferred_dinner_time'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const userCookingProfiles = sqliteTable('user_cooking_profiles', {
	workosUserId: text('workos_user_id').primaryKey(),
	cookTimeCoefficient: real('cook_time_coefficient').notNull().default(1),
	preferredDinnerTime: text('preferred_dinner_time'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});
