import type Stripe from 'stripe';

import type { BillingRepository } from './repository.js';
import { effectiveStripeStatus, projectionFromStripeSubscription } from './subscriptions.js';

export const TRIAL_RESERVATION_TIMEOUT_MS = 60 * 60 * 1_000;

const missingStripeResource = (cause: unknown): boolean =>
	typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 404;

const removeCustomer = async (
	stripe: Stripe,
	claim: {
		readonly id: string;
		readonly stripeCustomerId: string | null;
	}
): Promise<void> => {
	if (claim.stripeCustomerId) {
		try {
			await stripe.customers.del(
				claim.stripeCustomerId,
				{},
				{ idempotencyKey: `maal-trial-rollback-customer:${claim.id}` }
			);
		} catch (cause) {
			if (!missingStripeResource(cause)) throw cause;
		}
	}
};

const retrieveSubscription = async (
	stripe: Stripe,
	subscriptionId: string
): Promise<Stripe.Subscription | null> => {
	try {
		return await stripe.subscriptions.retrieve(subscriptionId, {
			expand: ['items.data.price']
		});
	} catch (cause) {
		if (missingStripeResource(cause)) return null;
		throw cause;
	}
};

const subscriptionResourceIsLive = (subscription: Stripe.Subscription): boolean => {
	const status = effectiveStripeStatus(subscription);
	return (
		status === 'active' || status === 'trialing' || status === 'past_due' || status === 'paused'
	);
};

export const reconcileStaleTrialClaims = async (input: {
	repository: BillingRepository;
	stripe: Stripe;
	now: string;
	limit?: number;
}): Promise<{ reservationsReleased: number; rollbacksCompleted: number; pending: number }> => {
	const staleBefore = new Date(Date.parse(input.now) - TRIAL_RESERVATION_TIMEOUT_MS).toISOString();
	const claims = await input.repository.staleTrialClaims(staleBefore, input.limit);
	let reservationsReleased = 0;
	let rollbacksCompleted = 0;
	let pending = 0;
	for (const claim of claims) {
		if (
			claim.state === 'reserved' &&
			claim.stripeCustomerId === null &&
			claim.stripeSubscriptionId === null
		) {
			if (await input.repository.releaseStaleTrialReservation(claim.id, staleBefore)) {
				reservationsReleased += 1;
			}
			continue;
		}
		try {
			const subscription = claim.stripeSubscriptionId
				? await retrieveSubscription(input.stripe, claim.stripeSubscriptionId)
				: null;
			if (subscription && subscriptionResourceIsLive(subscription)) {
				await input.repository.commitStartedTrial({
					claimId: claim.id,
					startedAt: claim.reservedAt,
					projection: projectionFromStripeSubscription({
						subscription,
						householdId: claim.householdId,
						subscriberUserId: claim.workosUserId,
						eventId: `trial-recovery:${claim.id}`,
						eventCreatedAt: input.now,
						eventReceivedAt: input.now,
						existing: await input.repository.subscription(claim.householdId),
						paidPeriodSucceeded: false
					})
				});
				rollbacksCompleted += 1;
				continue;
			}
			if (subscription && subscription.status !== 'canceled') {
				await input.stripe.subscriptions.cancel(
					subscription.id,
					{},
					{ idempotencyKey: `maal-trial-rollback-subscription:${claim.id}` }
				);
			}
			await removeCustomer(input.stripe, claim);
			const completed = claim.stripeSubscriptionId
				? await input.repository.completeTrialRollback(claim.id, input.now)
				: await input.repository.releaseTrialClaimAfterRollback(claim.id);
			if (completed) {
				rollbacksCompleted += 1;
				if (claim.stripeSubscriptionId)
					await input.repository.audit({
						idempotencyKey: `trial:${claim.id}:rollback-completed`,
						householdId: claim.householdId,
						actorUserId: claim.workosUserId,
						eventType: 'trial_rollback_completed_claim_retained',
						occurredAt: input.now
					});
			}
		} catch {
			pending += 1;
		}
	}
	return { reservationsReleased, rollbacksCompleted, pending };
};
