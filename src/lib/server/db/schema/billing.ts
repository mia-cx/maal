import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, updatedAt } from './common';
import { households } from './households';

export const billingSubscriptions = sqliteTable(
	'billing_subscriptions',
	{
		householdId: text('household_id')
			.primaryKey()
			.references(() => households.householdId, { onDelete: 'cascade' }),
		stripeCustomerId: text('stripe_customer_id').notNull(),
		subscriberUserId: text('subscriber_user_id'),
		stripeSubscriptionId: text('stripe_subscription_id'),
		stripePriceId: text('stripe_price_id'),
		status: text('status').notNull(),
		currentPeriodEnd: text('current_period_end'),
		cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
			.notNull()
			.default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('billing_subscriptions_customer_idx').on(table.stripeCustomerId),
		index('billing_subscriptions_subscriber_idx').on(table.subscriberUserId),
		index('billing_subscriptions_subscription_idx').on(table.stripeSubscriptionId)
	]
);
