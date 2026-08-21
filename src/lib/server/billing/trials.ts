import type Stripe from 'stripe';

import { listMaalPrices, requireMaalPrice } from './pricing.js';
import type { BillingRepository } from './repository.js';
import { assertTrialAvailable, projectionFromStripeSubscription } from './subscriptions.js';

export const startMaalTrial = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	productId: string;
	householdId: string;
	workosUserId: string;
	email: string;
	priceId?: string;
	trialDays: number;
	now: string;
}): Promise<void> => {
	await assertTrialAvailable(input.repository, input.workosUserId, input.householdId, input.now);
	const price = input.priceId
		? await requireMaalPrice(input.stripe, input.productId, input.priceId)
		: (await listMaalPrices(input.stripe, input.productId)).find(
				({ interval }) => interval === 'month'
			);
	if (!price) throw new TrialConfigurationError();
	const claimId = crypto.randomUUID();
	try {
		await input.repository.reserveTrial({
			id: claimId,
			workosUserId: input.workosUserId,
			householdId: input.householdId,
			reservedAt: input.now
		});
	} catch {
		// A competing request can win either independent UNIQUE constraint after the availability read.
		await assertTrialAvailable(input.repository, input.workosUserId, input.householdId, input.now);
		throw new TrialStartError('claim_reservation_failed');
	}

	let customerId: string | null = null;
	let subscriptionId: string | null = null;
	try {
		const customer = await input.stripe.customers.create(
			{
				email: input.email,
				metadata: { householdId: input.householdId, workosUserId: input.workosUserId }
			},
			{ idempotencyKey: `maal-trial-customer:${claimId}` }
		);
		customerId = customer.id;
		const subscription = await input.stripe.subscriptions.create(
			{
				customer: customer.id,
				items: [{ price: price.id }],
				metadata: { householdId: input.householdId, workosUserId: input.workosUserId },
				trial_period_days: input.trialDays,
				trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }
			},
			{ idempotencyKey: `maal-trial-subscription:${claimId}` }
		);
		subscriptionId = subscription.id;
		await input.repository.commitStartedTrial({
			claimId,
			startedAt: input.now,
			projection: projectionFromStripeSubscription({
				subscription,
				householdId: input.householdId,
				subscriberUserId: input.workosUserId,
				eventId: `trial:${claimId}`,
				eventCreatedAt: input.now,
				eventReceivedAt: input.now,
				existing: null,
				paidPeriodSucceeded: false
			})
		});
	} catch (cause) {
		let subscriptionRemoved = subscriptionId === null;
		let customerRemoved = customerId === null;
		if (subscriptionId) {
			try {
				await input.stripe.subscriptions.update(subscriptionId, {
					metadata: { maal_trial_rollback: 'start_failed' }
				});
				await input.stripe.subscriptions.cancel(subscriptionId);
				subscriptionRemoved = true;
			} catch {
				subscriptionRemoved = false;
			}
		}
		if (customerId) {
			try {
				await input.stripe.customers.del(customerId);
				customerRemoved = true;
			} catch {
				customerRemoved = false;
			}
		}
		if (subscriptionRemoved && customerRemoved) {
			await input.repository.abandonTrialReservation(claimId);
		} else {
			await input.repository.markTrialRollbackPending({
				id: claimId,
				stripeCustomerId: customerId,
				stripeSubscriptionId: subscriptionId,
				updatedAt: input.now
			});
		}
		throw new TrialStartError(
			subscriptionRemoved && customerRemoved ? 'rolled_back' : 'rollback_pending',
			{ cause }
		);
	}
};

export class TrialConfigurationError extends Error {
	readonly _tag = 'TrialConfigurationError';
	constructor() {
		super('A monthly Maal price is required for trials.');
	}
}

export class TrialStartError extends Error {
	readonly _tag = 'TrialStartError';
	constructor(
		readonly reason: 'claim_reservation_failed' | 'rolled_back' | 'rollback_pending',
		options?: ErrorOptions
	) {
		super('The trial could not be started.', options);
	}
}
