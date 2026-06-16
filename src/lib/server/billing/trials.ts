import { env as privateEnv } from '$env/dynamic/private';
import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import { getDb } from '$lib/server/db';
import { households, users } from '$lib/server/db/schema';
import { trialDefaultPricingOptionFromPrices } from './pricing-options';
import { createStripeClient, getStripeProductId } from './stripe';
import { deleteSubscriptionRecord, loadBillingStatus, upsertSubscription } from './subscriptions';

const defaultTrialDays = 30;

const trialDays = (): number => {
	const parsed = privateEnv.MAAL_TRIAL_DAYS
		? Number.parseInt(privateEnv.MAAL_TRIAL_DAYS, 10)
		: defaultTrialDays;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultTrialDays;
};

const findDefaultTrialPriceId = async (stripe: Stripe, productId: string): Promise<string> => {
	const prices: Stripe.Price[] = [];
	await stripe.prices
		.list({ product: productId, active: true, limit: 100 })
		.autoPagingEach((price) => {
			prices.push(price);
		});

	const priceId = trialDefaultPricingOptionFromPrices(prices, productId)?.id;
	if (!priceId) throw new Error('No paid recurring Stripe price is configured for trials.');
	return priceId;
};

export type TrialAvailability = {
	available: boolean;
	reason: 'available' | 'already_used' | 'not_creator' | 'already_subscribed' | 'missing_storage';
};

export const loadTrialAvailability = async (input: {
	database: D1Database | undefined;
	userId: string;
	householdId: string | null;
}): Promise<TrialAvailability> => {
	if (!input.database) return { available: false, reason: 'missing_storage' };
	if (!input.householdId) return { available: false, reason: 'not_creator' };

	const db = getDb(input.database);
	const [userRow] = await db
		.select({ trialHouseholdId: users.trialHouseholdId })
		.from(users)
		.where(eq(users.workosUserId, input.userId))
		.limit(1);
	if (userRow?.trialHouseholdId) return { available: false, reason: 'already_used' };

	const [householdRow] = await db
		.select({ createdByUserId: households.createdByUserId })
		.from(households)
		.where(eq(households.householdId, input.householdId))
		.limit(1);
	if (householdRow?.createdByUserId !== input.userId) {
		return { available: false, reason: 'not_creator' };
	}

	const billing = await loadBillingStatus(input.database, input.householdId);
	if (billing.stripeCustomerId || billing.isPaid)
		return { available: false, reason: 'already_subscribed' };

	return { available: true, reason: 'available' };
};

export const startHouseholdTrial = async (input: {
	platform: App.Platform | undefined;
	user: { id: string; email: string; name?: string | null };
	householdId: string;
	priceId?: string | null;
}): Promise<Stripe.Subscription> => {
	if (!input.platform?.env.DB) throw new Error('Billing storage is not available.');

	const db = getDb(input.platform.env.DB);
	const availability = await loadTrialAvailability({
		database: input.platform.env.DB,
		userId: input.user.id,
		householdId: input.householdId
	});
	if (!availability.available) throw new Error(`Trial is not available: ${availability.reason}.`);

	const claimed = await db
		.update(users)
		.set({
			trialHouseholdId: input.householdId,
			trialStartedAt: new Date().toISOString()
		})
		.where(and(eq(users.workosUserId, input.user.id), isNull(users.trialHouseholdId)))
		.returning({ workosUserId: users.workosUserId });
	if (!claimed.length) throw new Error('Trial has already been used.');

	let stripe: Stripe | null = null;
	let customerId: string | null = null;
	let subscriptionId: string | null = null;

	try {
		stripe = createStripeClient(input.platform);
		const priceId =
			input.priceId ?? (await findDefaultTrialPriceId(stripe, getStripeProductId(input.platform)));
		const customer = await stripe.customers.create({
			email: input.user.email,
			name: input.user.name ?? undefined,
			metadata: { householdId: input.householdId, workosUserId: input.user.id }
		});
		customerId = customer.id;
		const subscription = await stripe.subscriptions.create({
			customer: customer.id,
			items: [{ price: priceId }],
			metadata: { householdId: input.householdId, workosUserId: input.user.id },
			trial_period_days: trialDays(),
			trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }
		});
		subscriptionId = subscription.id;

		await upsertSubscription({
			database: input.platform.env.DB,
			householdId: input.householdId,
			customerId: customer.id,
			subscriberUserId: input.user.id,
			subscription
		});
		return subscription;
	} catch (cause) {
		const cleanupFailures: unknown[] = [];
		if (stripe && subscriptionId) {
			try {
				await stripe.subscriptions.update(subscriptionId, {
					metadata: { maal_trial_rollback: 'start_failed' }
				});
			} catch (cleanupCause) {
				cleanupFailures.push(cleanupCause);
			}
			try {
				await stripe.subscriptions.cancel(subscriptionId);
			} catch (cleanupCause) {
				cleanupFailures.push(cleanupCause);
			}
		}
		if (stripe && customerId) {
			try {
				await stripe.customers.del(customerId);
			} catch (cleanupCause) {
				cleanupFailures.push(cleanupCause);
			}
		}
		try {
			await db
				.update(users)
				.set({ trialHouseholdId: null, trialStartedAt: null })
				.where(eq(users.workosUserId, input.user.id));
		} catch (cleanupCause) {
			cleanupFailures.push(cleanupCause);
		}
		if (customerId && subscriptionId) {
			try {
				await deleteSubscriptionRecord({
					database: input.platform.env.DB,
					householdId: input.householdId,
					customerId,
					subscriptionId
				});
			} catch (cleanupCause) {
				cleanupFailures.push(cleanupCause);
			}
		}
		if (cleanupFailures.length) {
			throw new AggregateError(
				[cause, ...cleanupFailures],
				'Trial start failed and rollback was incomplete',
				{
					cause
				}
			);
		}
		throw cause;
	}
};
