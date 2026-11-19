import type Stripe from 'stripe';

import { BillingConflictError } from './errors.js';
import { requireMaalPrice } from './pricing.js';
import type { BillingRepository } from './repository.js';
import { openStripeSubscriptions } from './subscriptions.js';

export const createMaalCheckout = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	productId: string;
	householdId: string;
	workosUserId: string;
	email: string;
	priceId: string;
	origin: string;
	idempotencyKey: string;
	now: string;
}): Promise<{ url: string }> => {
	await requireMaalPrice(input.stripe, input.productId, input.priceId);
	const [existing, deletion] = await Promise.all([
		input.repository.subscription(input.householdId),
		input.repository.deletionRequest(input.householdId)
	]);
	if (deletion !== null && deletion.state !== 'recovered') {
		throw new BillingConflictError('household_deletion_pending');
	}

	const customerId =
		existing?.stripeCustomerId ??
		(
			await input.stripe.customers.create(
				{
					email: input.email,
					metadata: { householdId: input.householdId, workosUserId: input.workosUserId }
				},
				{ idempotencyKey: `maal-customer:${input.householdId}` }
			)
		).id;
	// Stripe, not the projection, decides: a lapsed subscription that Stripe still retries, or a
	// completed checkout whose webhook has not landed, must be paid or cancelled, never doubled.
	if ((await openStripeSubscriptions(input.stripe, customerId)).length > 0) {
		throw new BillingConflictError('already_subscribed');
	}
	const session = await input.stripe.checkout.sessions.create(
		{
			mode: 'subscription',
			customer: customerId,
			client_reference_id: input.householdId,
			line_items: [{ price: input.priceId, quantity: 1 }],
			metadata: { householdId: input.householdId, workosUserId: input.workosUserId },
			subscription_data: {
				metadata: { householdId: input.householdId, workosUserId: input.workosUserId }
			},
			success_url: `${input.origin}/household?billing=checkout-success`,
			cancel_url: `${input.origin}/household?billing=checkout-cancelled`
		},
		{ idempotencyKey: input.idempotencyKey }
	);
	if (!session.url) throw new BillingCheckoutError();
	return { url: session.url };
};

export const createMaalPortal = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	householdId: string;
	workosUserId: string;
	origin: string;
}): Promise<{ url: string }> => {
	const subscription = await input.repository.subscription(input.householdId);
	if (!subscription?.stripeCustomerId) throw new BillingConflictError('customer_missing');
	if (subscription.subscriberUserId !== input.workosUserId) {
		throw new BillingConflictError('billing_owner_required');
	}
	const portal = await input.stripe.billingPortal.sessions.create({
		customer: subscription.stripeCustomerId,
		return_url: `${input.origin}/household?billing=returned`
	});
	return { url: portal.url };
};

export class BillingCheckoutError extends Error {
	readonly _tag = 'BillingCheckoutError';
	constructor() {
		super('Stripe did not return a checkout URL.');
	}
}
