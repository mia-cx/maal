import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { applianceValues } from '../../../domain/household/appliances';
import { createdAt, id, updatedAt } from './common';

export const households = sqliteTable('households', {
	householdId: text('household_id').primaryKey(),
	locale: text('locale').notNull().default('en-US'),
	timezone: text('timezone'),
	weekStartsOn: integer('week_starts_on').notNull().default(1),
	defaultPlannedYield: integer('default_planned_yield').notNull().default(1),
	preferredDinnerTime: text('preferred_dinner_time'),
	createdByUserId: text('created_by_user_id'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const householdMembershipMutationLocks = sqliteTable('household_membership_mutation_locks', {
	householdId: text('household_id')
		.primaryKey()
		.references(() => households.householdId, { onDelete: 'cascade' }),
	ownerToken: text('owner_token').notNull(),
	expiresAt: text('expires_at').notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const householdAppliances = sqliteTable(
	'household_appliances',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		appliance: text('appliance', { enum: applianceValues }).notNull(),
		available: integer('available', { mode: 'boolean' }).notNull().default(true),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('household_appliances_household_id_idx').on(table.householdId),
		uniqueIndex('household_appliances_household_appliance_unique').on(
			table.householdId,
			table.appliance
		)
	]
);
