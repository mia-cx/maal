import { eq, or } from 'drizzle-orm';
import type Stripe from 'stripe';
import { getDb } from '$lib/server/db';
import { billingSubscriptions } from '$lib/server/db/schema';
import { currentPeriodEndIso, subscriptionPriceId } from './stripe';

export type BillingStatus = {
	householdId: string;
	stripeCustomerId: string | null;
	subscriberUserId: string | null;
	stripeSubscriptionId: string | null;
	stripePriceId: string | null;
	status: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	isPaid: boolean;
};

const paidStatuses = new Set(['active', 'trialing']);

export const loadBillingStatus = async (
	database: D1Database,
	householdId: string
): Promise<BillingStatus> => {
	const row = await getDb(database)
		.select()
		.from(billingSubscriptions)
		.where(eq(billingSubscriptions.householdId, householdId))
		.limit(1);
	const subscription = row[0];
	return {
		householdId,
		stripeCustomerId: subscription?.stripeCustomerId ?? null,
		subscriberUserId: subscription?.subscriberUserId ?? null,
		stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
		stripePriceId: subscription?.stripePriceId ?? null,
		status: subscription?.status ?? null,
		currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
		cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
		isPaid: paidStatuses.has(subscription?.status ?? '')
	};
};

export const upsertSubscription = async (input: {
	database: D1Database;
	householdId: string;
	customerId: string;
	subscriberUserId?: string | null;
	subscription: Stripe.Subscription | null;
	status?: string;
}) => {
	const now = new Date().toISOString();
	const subscriberUserId =
		input.subscriberUserId ?? input.subscription?.metadata.workosUserId ?? null;
	await getDb(input.database)
		.insert(billingSubscriptions)
		.values({
			householdId: input.householdId,
			stripeCustomerId: input.customerId,
			subscriberUserId,
			stripeSubscriptionId: input.subscription?.id ?? null,
			stripePriceId: input.subscription ? subscriptionPriceId(input.subscription) : null,
			status: input.subscription?.status ?? input.status ?? 'unknown',
			currentPeriodEnd: input.subscription ? currentPeriodEndIso(input.subscription) : null,
			cancelAtPeriodEnd: input.subscription?.cancel_at_period_end ?? false,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: billingSubscriptions.householdId,
			set: {
				stripeCustomerId: input.customerId,
				subscriberUserId,
				stripeSubscriptionId: input.subscription?.id ?? null,
				stripePriceId: input.subscription ? subscriptionPriceId(input.subscription) : null,
				status: input.subscription?.status ?? input.status ?? 'unknown',
				currentPeriodEnd: input.subscription ? currentPeriodEndIso(input.subscription) : null,
				cancelAtPeriodEnd: input.subscription?.cancel_at_period_end ?? false,
				updatedAt: now
			}
		});
};

export const findHouseholdIdForStripeSubscription = async (input: {
	database: D1Database;
	customerId?: string | null;
	subscriptionId?: string | null;
}): Promise<string | null> => {
	if (!input.customerId && !input.subscriptionId) return null;
	const rows = await getDb(input.database)
		.select({ householdId: billingSubscriptions.householdId })
		.from(billingSubscriptions)
		.where(
			or(
				...(input.customerId ? [eq(billingSubscriptions.stripeCustomerId, input.customerId)] : []),
				...(input.subscriptionId
					? [eq(billingSubscriptions.stripeSubscriptionId, input.subscriptionId)]
					: [])
			)
		)
		.limit(1);
	return rows[0]?.householdId ?? null;
};
