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
import { createdAt, enumCheck, mutableColumns, nonNegative, updatedAt } from './common.js';
import { applianceValues, householdRoleValues } from './enums.js';

export const users = sqliteTable('users', {
	workosUserId: text('workos_user_id').primaryKey(),
	locale: text('locale').notNull().default('en-US'),
	timezone: text('timezone'),
	cachedCookTimeCoefficient: real('cached_cook_time_coefficient').notNull().default(1),
	cookTimeCoefficientUpdatedAt: text('cook_time_coefficient_updated_at'),
	...mutableColumns()
});

export const households = sqliteTable(
	'households',
	{
		householdId: text('household_id').primaryKey(),
		locale: text('locale').notNull().default('en-US'),
		timezone: text('timezone'),
		weekStartsOn: integer('week_starts_on').notNull().default(1),
		defaultPlannedYield: integer('default_planned_yield').notNull().default(1),
		preferredDinnerTime: text('preferred_dinner_time'),
		createdByUserId: text('created_by_user_id').references(() => users.workosUserId, {
			onDelete: 'set null'
		}),
		...mutableColumns()
	},
	(table) => [
		check('households_week_starts_on_range', sql`${table.weekStartsOn} IN (0, 1)`),
		check('households_default_planned_yield_positive', sql`${table.defaultPlannedYield} > 0`)
	]
);

export const householdMemberships = sqliteTable(
	'household_memberships',
	{
		membershipId: text('membership_id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		workosUserId: text('workos_user_id')
			.notNull()
			.references(() => users.workosUserId, { onDelete: 'cascade' }),
		roleSlug: text('role_slug', { enum: householdRoleValues }).notNull(),
		permissions: text('permissions').notNull(),
		status: text('status').notNull(),
		directoryManaged: integer('directory_managed', { mode: 'boolean' }).notNull().default(false),
		workosCreatedAt: text('workos_created_at').notNull(),
		lastVerifiedAt: text('last_verified_at').notNull(),
		updatedAt: updatedAt()
	},
	(table) => [
		uniqueIndex('household_memberships_household_user_unique').on(
			table.householdId,
			table.workosUserId
		),
		index('household_memberships_user_status_idx').on(table.workosUserId, table.status),
		index('household_memberships_household_status_idx').on(table.householdId, table.status),
		enumCheck('household_memberships_role_check', table.roleSlug, householdRoleValues),
		check('household_memberships_permissions_json_check', sql`json_valid(${table.permissions})`)
	]
);

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
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		appliance: text('appliance', { enum: applianceValues }).notNull(),
		available: integer('available', { mode: 'boolean' }).notNull().default(true),
		notes: text('notes'),
		...mutableColumns()
	},
	(table) => [
		uniqueIndex('household_appliances_household_appliance_unique').on(
			table.householdId,
			table.appliance
		),
		index('household_appliances_household_idx').on(table.householdId),
		enumCheck('household_appliances_appliance_check', table.appliance, applianceValues)
	]
);

export const householdInvites = sqliteTable(
	'household_invites',
	{
		id: text('id').primaryKey(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		codeHash: text('code_hash').notNull(),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => users.workosUserId),
		roleSlug: text('role_slug', { enum: householdRoleValues }).notNull().default('member'),
		maxUses: integer('max_uses'),
		usesCount: integer('uses_count').notNull().default(0),
		expiresAt: text('expires_at').notNull(),
		revokedAt: text('revoked_at'),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('household_invites_code_hash_unique').on(table.codeHash),
		index('household_invites_household_idx').on(table.householdId),
		index('household_invites_expiry_idx').on(table.expiresAt, table.revokedAt),
		enumCheck('household_invites_role_check', table.roleSlug, householdRoleValues),
		check(
			'household_invites_max_uses_range',
			sql`${table.maxUses} IS NULL OR (${table.maxUses} >= 1 AND ${table.maxUses} <= 100)`
		),
		check('household_invites_uses_count_nonnegative', nonNegative(table.usesCount)),
		check(
			'household_invites_uses_within_limit',
			sql`${table.maxUses} IS NULL OR ${table.usesCount} <= ${table.maxUses}`
		)
	]
);
