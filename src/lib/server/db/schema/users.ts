import { real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, updatedAt } from './common';

export const users = sqliteTable('users', {
	workosUserId: text('workos_user_id').primaryKey(),
	locale: text('locale').notNull().default('en-US'),
	timezone: text('timezone'),
	cachedCookTimeCoefficient: real('cached_cook_time_coefficient').notNull().default(1),
	cookTimeCoefficientUpdatedAt: text('cook_time_coefficient_updated_at'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});
