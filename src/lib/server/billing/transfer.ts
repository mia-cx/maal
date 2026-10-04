import type Stripe from 'stripe';

import { BillingConflictError } from './errors.js';
import type { BillingRepository, BillingSubscriptionRow } from './repository.js';
import { subscriptionIsOpen } from './subscriptions.js';

export const PAYER_CLEANUP_PENDING_EVENT = 'billing_payer_cleanup_pending';
export const PAYER_CLEANUP_COMPLETED_EVENT = 'billing_payer_cleanup_completed';

const payerCleanupPendingKey = (subscriptionId: string, newUserId: string, now: string) =>
	`payer-cleanup:${subscriptionId}:${newUserId}:${now}`;
const payerCleanupCompletedKey = (pendingKey: string) =>
	`payer-cleanup-completed:${pendingKey.slice('payer-cleanup:'.length)}`;

const stringId = (value: string | { id: string } | null): string | null =>
	value === null ? null : typeof value === 'string' ? value : value.id;

/**
 * Detaches exactly the payment methods recorded for the previous payer. A method that is no
 * longer attached to this customer counts as done; anything the new owner added — even one
 * created earlier — was never listed and is never touched.
 */
const detachPayerPaymentMethods = async (
	stripe: Stripe,
	customerId: string,
	paymentMethodIds: readonly string[]
): Promise<void> => {
	for (const id of paymentMethodIds) {
		const method = await stripe.paymentMethods.retrieve(id);
		if (method !== null && stringId(method.customer ?? null) === customerId) {
			await stripe.paymentMethods.detach(id);
		}
	}
};

/**
 * Moves billing ownership to another active admin. Stripe is updated step by step so a failure
 * never leaves it half-changed: the subscription first, then the customer, each rolled back with
 * the D1 row on failure. Payment-method cleanup is recorded as pending before it runs so that a
 * detach failure leaves ownership transferred while scheduled maintenance finishes the job.
 */
export const transferBillingOwnership = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	householdId: string;
	currentUserId: string;
	newUserId: string;
	now: string;
}): Promise<{ payerCleanup: 'completed' | 'pending' }> => {
	if (input.newUserId === input.currentUserId) {
		throw new BillingConflictError('target_must_differ');
	}
	const subscription = await input.repository.subscription(input.householdId);
	if (!subscription) throw new BillingConflictError('subscription_missing');
	if (subscription.subscriberUserId !== input.currentUserId) {
		throw new BillingConflictError('billing_owner_required');
	}
	const stripeSubscription = await input.stripe.subscriptions.retrieve(
		subscription.stripeSubscriptionId
	);
	// The previous payer's methods are enumerated before anything changes, while they are
	// unambiguous, and recorded so both this request and any maintenance retry detach exactly
	// this set. A failure here leaves D1 and Stripe untouched.
	const payerPaymentMethods = await input.stripe.customers.listPaymentMethods(
		subscription.stripeCustomerId,
		{ limit: 100 }
	);
	const payerPaymentMethodIds = payerPaymentMethods.data.map((method) => method.id);
	const rollbackOwner = () =>
		input.repository.transferBillingOwner({
			householdId: input.householdId,
			currentUserId: input.newUserId,
			newUserId: input.currentUserId,
			updatedAt: input.now
		});
	const transferred = await input.repository.transferBillingOwner({
		householdId: input.householdId,
		currentUserId: input.currentUserId,
		newUserId: input.newUserId,
		updatedAt: input.now
	});
	if (!transferred) throw new BillingConflictError('target_must_be_active_admin');
	try {
		await input.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
			default_payment_method: '',
			metadata: { householdId: input.householdId, workosUserId: input.newUserId }
		});
	} catch (cause) {
		await rollbackOwner();
		throw cause;
	}
	try {
		await input.stripe.customers.update(subscription.stripeCustomerId, {
			email: '',
			name: '',
			invoice_settings: { default_payment_method: '' },
			metadata: { householdId: input.householdId, workosUserId: input.newUserId }
		});
	} catch (cause) {
		await input.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
			default_payment_method: stringId(stripeSubscription.default_payment_method ?? null) ?? '',
			metadata: { householdId: input.householdId, workosUserId: input.currentUserId }
		});
		await rollbackOwner();
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
	const cleanupKey = payerCleanupPendingKey(
		subscription.stripeSubscriptionId,
		input.newUserId,
		input.now
	);
	await input.repository.audit({
		idempotencyKey: cleanupKey,
		householdId: input.householdId,
		actorUserId: input.currentUserId,
		eventType: PAYER_CLEANUP_PENDING_EVENT,
		occurredAt: input.now,
		safeDetails: {
			stripeCustomerId: subscription.stripeCustomerId,
			paymentMethodIds: JSON.stringify(payerPaymentMethodIds)
		}
	});
	try {
		await detachPayerPaymentMethods(
			input.stripe,
			subscription.stripeCustomerId,
			payerPaymentMethodIds
		);
	} catch {
		return { payerCleanup: 'pending' };
	}
	await input.repository.audit({
		idempotencyKey: payerCleanupCompletedKey(cleanupKey),
		householdId: input.householdId,
		actorUserId: input.currentUserId,
		eventType: PAYER_CLEANUP_COMPLETED_EVENT,
		occurredAt: input.now
	});
	return { payerCleanup: 'completed' };
};

/**
 * Re-runs payment-method cleanup for transfers whose detach failed. The pending audit record
 * carries the customer and the previous payer's method ids, so only those detach.
 */
export const reconcilePendingPayerCleanups = async (input: {
	repository: BillingRepository;
	stripe: Stripe;
	now: string;
	limit?: number;
}): Promise<{ completed: number; pending: number }> => {
	const cleanups = await input.repository.pendingPayerCleanups(input.limit);
	let completed = 0;
	let pending = 0;
	for (const cleanup of cleanups) {
		const details = JSON.parse(cleanup.safeDetails) as {
			stripeCustomerId?: string;
			paymentMethodIds?: string;
		};
		const paymentMethodIds: unknown =
			typeof details.paymentMethodIds === 'string'
				? JSON.parse(details.paymentMethodIds)
				: undefined;
		if (
			!details.stripeCustomerId ||
			!Array.isArray(paymentMethodIds) ||
			cleanup.householdId === null
		) {
			continue;
		}
		try {
			await detachPayerPaymentMethods(input.stripe, details.stripeCustomerId, paymentMethodIds);
			await input.repository.audit({
				idempotencyKey: payerCleanupCompletedKey(cleanup.idempotencyKey),
				householdId: cleanup.householdId,
				actorUserId: null,
				eventType: PAYER_CLEANUP_COMPLETED_EVENT,
				occurredAt: input.now
			});
			completed += 1;
		} catch {
			pending += 1;
		}
	}
	return { completed, pending };
};

/**
 * Whether the billing owner may leave, be removed, or lose admin: when the subscription can no
 * longer bill (terminal in Stripe) or cancellation is already scheduled on a healthy one. An
 * open subscription that merely stopped enabling service — lapsed, unpaid, out of grace — can
 * still be revived and would strand the household without a payer, so the owner must transfer
 * or finish canceling first.
 */
export const billingOwnerMayLeave = (
	subscription: Pick<BillingSubscriptionRow, 'status' | 'cancelAtPeriodEnd'>
): boolean =>
	!subscriptionIsOpen(subscription.status) ||
	(subscription.cancelAtPeriodEnd &&
		(subscription.status === 'active' || subscription.status === 'trialing'));
