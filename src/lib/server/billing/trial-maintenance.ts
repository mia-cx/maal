import type Stripe from 'stripe';

import type { BillingRepository } from './repository.js';

export const TRIAL_RESERVATION_TIMEOUT_MS = 60 * 60 * 1_000;

const missingStripeResource = (cause: unknown): boolean =>
	typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 404;

const removeRollbackResources = async (
	stripe: Stripe,
	claim: {
		readonly id: string;
		readonly stripeSubscriptionId: string | null;
		readonly stripeCustomerId: string | null;
	}
): Promise<void> => {
	if (claim.stripeSubscriptionId) {
		try {
			await stripe.subscriptions.cancel(
				claim.stripeSubscriptionId,
				{},
				{ idempotencyKey: `maal-trial-rollback-subscription:${claim.id}` }
			);
		} catch (cause) {
			if (!missingStripeResource(cause)) throw cause;
		}
	}
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
		if (claim.state === 'reserved') {
			if (await input.repository.releaseStaleTrialReservation(claim.id, staleBefore)) {
				reservationsReleased += 1;
			}
			continue;
		}
		try {
			await removeRollbackResources(input.stripe, claim);
			if (await input.repository.completeTrialRollback(claim.id, input.now)) {
				rollbacksCompleted += 1;
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
