import { and, eq, or } from 'drizzle-orm';
import type Stripe from 'stripe';
import { getDb } from '$lib/server/db';
import { billingSubscriptions } from '$lib/server/db/schema';
import { createStripeClient, currentPeriodEndIso, subscriptionPriceId } from './stripe';
import { billingStatusFromStripe, paidBillingStatuses } from './status';

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
		isPaid: paidBillingStatuses.has(billingStatusFromStripe(subscription?.status))
	};
};

export const loadFreshBillingStatus = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<BillingStatus> => {
	if (!platform?.env.DB) throw new Error('Billing storage is not available.');

	const billing = await loadBillingStatus(platform.env.DB, householdId);
	if (!billing.isPaid || !billing.stripeSubscriptionId) return billing;

	try {
		const subscription = await createStripeClient(platform).subscriptions.retrieve(
			billing.stripeSubscriptionId,
			{ expand: ['items.data.price'] }
		);
		await upsertSubscription({
			database: platform.env.DB,
			householdId,
			customerId:
				typeof subscription.customer === 'string'
					? subscription.customer
					: subscription.customer.id,
			subscriberUserId: billing.subscriberUserId,
			subscription
		});
		return loadBillingStatus(platform.env.DB, householdId);
	} catch (cause) {
		console.error('Failed to refresh Stripe subscription status', cause);
		return billing;
	}
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
			status: billingStatusFromStripe(input.subscription?.status ?? input.status),
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
				status: billingStatusFromStripe(input.subscription?.status ?? input.status),
				currentPeriodEnd: input.subscription ? currentPeriodEndIso(input.subscription) : null,
				cancelAtPeriodEnd: input.subscription?.cancel_at_period_end ?? false,
				updatedAt: now
			}
		});
};

export const deleteSubscriptionRecord = async (input: {
	database: D1Database;
	householdId?: string | null;
	customerId: string;
	subscriptionId: string;
}) => {
	await getDb(input.database)
		.delete(billingSubscriptions)
		.where(
			and(
				...(input.householdId ? [eq(billingSubscriptions.householdId, input.householdId)] : []),
				eq(billingSubscriptions.stripeCustomerId, input.customerId),
				eq(billingSubscriptions.stripeSubscriptionId, input.subscriptionId)
			)
		);
};

export type StripeSubscriptionRecord = {
	householdId: string;
	customerId: string;
	subscriptionId: string | null;
	status: string;
};

export const markSubscriptionRollbackPending = async (input: {
	database: D1Database;
	householdId: string;
	customerId: string;
	subscriptionId: string;
}) => {
	await upsertSubscription({
		database: input.database,
		householdId: input.householdId,
		customerId: input.customerId,
		subscription: null,
		status: 'trial_rollback_pending'
	});
	await getDb(input.database)
		.update(billingSubscriptions)
		.set({ stripeSubscriptionId: input.subscriptionId, updatedAt: new Date().toISOString() })
		.where(eq(billingSubscriptions.householdId, input.householdId));
};

export const findStripeSubscriptionRecordBySubscriptionId = async (input: {
	database: D1Database;
	subscriptionId: string;
}): Promise<StripeSubscriptionRecord | null> => {
	const rows = await getDb(input.database)
		.select({
			householdId: billingSubscriptions.householdId,
			customerId: billingSubscriptions.stripeCustomerId,
			subscriptionId: billingSubscriptions.stripeSubscriptionId,
			status: billingSubscriptions.status
		})
		.from(billingSubscriptions)
		.where(eq(billingSubscriptions.stripeSubscriptionId, input.subscriptionId))
		.limit(1);
	return rows[0] ?? null;
};

export const findHouseholdIdForStripeSubscriptionId = async (input: {
	database: D1Database;
	subscriptionId: string;
}): Promise<string | null> =>
	(
		await findStripeSubscriptionRecordBySubscriptionId({
			database: input.database,
			subscriptionId: input.subscriptionId
		})
	)?.householdId ?? null;

export const findStripeCustomerSubscription = async (input: {
	database: D1Database;
	customerId: string;
}): Promise<{ householdId: string; subscriptionId: string | null } | null> => {
	const rows = await getDb(input.database)
		.select({
			householdId: billingSubscriptions.householdId,
			subscriptionId: billingSubscriptions.stripeSubscriptionId
		})
		.from(billingSubscriptions)
		.where(eq(billingSubscriptions.stripeCustomerId, input.customerId))
		.limit(1);
	return rows[0] ?? null;
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
