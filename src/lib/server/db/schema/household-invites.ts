import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id } from './common';
import { households } from './households';

export const householdInvites = sqliteTable(
	'household_invites',
	{
		id: id(),
		householdId: text('household_id')
			.notNull()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		code: text('code').notNull(),
		createdByUserId: text('created_by_user_id').notNull(),
		roleSlug: text('role_slug').notNull().default('member'),
		maxUses: integer('max_uses'),
		usesCount: integer('uses_count').notNull().default(0),
		expiresAt: text('expires_at'),
		revokedAt: text('revoked_at'),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('household_invites_code_unique').on(table.code),
		index('household_invites_household_id_idx').on(table.householdId)
	]
);
