import type Stripe from 'stripe';

import { subscriptionEnablesRemoteService } from './entitlement.js';
import { BillingConflictError } from './errors.js';
import type { BillingRepository, BillingSubscriptionRow } from './repository.js';

/**
 * Removes the previous owner as payer of the household's Stripe customer: their contact details,
 * default payment method, and every saved payment method. Stripe cannot move a subscription to
 * another customer, so the household keeps its customer and the new owner adds their card
 * through the billing portal. Until they do, the next renewal fails into the grace window.
 */
const detachPreviousPayer = async (
	stripe: Stripe,
	subscription: BillingSubscriptionRow,
	newUserId: string
): Promise<void> => {
	const customerId = subscription.stripeCustomerId;
	await stripe.customers.update(customerId, {
		email: '',
		name: '',
		invoice_settings: { default_payment_method: '' },
		metadata: { householdId: subscription.householdId, workosUserId: newUserId }
	});
	const paymentMethods = await stripe.customers.listPaymentMethods(customerId, { limit: 100 });
	for (const { id } of paymentMethods.data) await stripe.paymentMethods.detach(id);
};

/**
 * Moves billing ownership to another active admin. The Stripe metadata update runs last because
 * webhook projections take the owner from it; a failure before then rolls D1 back.
 */
export const transferBillingOwnership = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	householdId: string;
	currentUserId: string;
	newUserId: string;
	now: string;
}): Promise<void> => {
	const subscription = await input.repository.subscription(input.householdId);
	if (!subscription) throw new BillingConflictError('subscription_missing');
	if (subscription.subscriberUserId !== input.currentUserId) {
		throw new BillingConflictError('billing_owner_required');
	}
	const transferred = await input.repository.transferBillingOwner({
		householdId: input.householdId,
		currentUserId: input.currentUserId,
		newUserId: input.newUserId,
		updatedAt: input.now
	});
	if (!transferred) throw new BillingConflictError('target_must_be_active_admin');
	try {
		await detachPreviousPayer(input.stripe, subscription, input.newUserId);
		await input.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
			default_payment_method: '',
			metadata: { householdId: input.householdId, workosUserId: input.newUserId }
		});
	} catch (cause) {
		await input.repository.transferBillingOwner({
			householdId: input.householdId,
			currentUserId: input.newUserId,
			newUserId: input.currentUserId,
			updatedAt: input.now
		});
		throw cause;
	}
	await input.repository.audit({
		idempotencyKey: `transfer:${subscription.stripeSubscriptionId}:${input.newUserId}`,
		householdId: input.householdId,
		actorUserId: input.currentUserId,
		eventType: 'billing_owner_transferred',
		occurredAt: input.now,
		safeDetails: { newSubscriberUserId: input.newUserId }
	});
};

/**
 * Whether the billing owner may leave, be removed, or lose admin: once cancellation is scheduled
 * or the subscription no longer enables remote service. Otherwise they must transfer first.
 */
export const billingOwnerMayLeave = (
	subscription: Pick<
		BillingSubscriptionRow,
		'status' | 'currentPeriodEnd' | 'graceUntil' | 'cancelAtPeriodEnd'
	>,
	now: string
): boolean =>
	subscription.cancelAtPeriodEnd || !subscriptionEnablesRemoteService(subscription, now);
