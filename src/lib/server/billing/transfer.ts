import type Stripe from 'stripe';

import { BillingConflictError } from './errors.js';
import type { BillingRepository } from './repository.js';

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
		await input.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
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

export const assertBillingOwnerMayLeave = async (
	repository: BillingRepository,
	householdId: string,
	workosUserId: string
): Promise<void> => {
	const subscription = await repository.subscription(householdId);
	if (
		subscription?.subscriberUserId === workosUserId &&
		(subscription.status === 'active' || subscription.status === 'trialing')
	) {
		throw new BillingConflictError('transfer_or_cancel_before_leaving');
	}
};
