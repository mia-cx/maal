import type Stripe from 'stripe';

import { projectBillingCapability } from '$lib/domain/billing/capability.js';
import type { BillingCapability } from '$lib/domain/billing/contracts.js';

import { TrialUnavailableError } from './errors.js';
import { decodeMaalPrice, MAAL_PRICE_LOOKUP_KEYS, requireMaalPrice } from './pricing.js';
import type { BillingRepository, SubscriptionProjectionWrite } from './repository.js';
import { createStripeClient, stripeProductId } from './stripe.js';
import { deletionAllowsProjectedSubscription } from './subscription-identity.js';
import { assertTrialAvailable, projectionFromStripeSubscription } from './subscriptions.js';

export const startConfiguredMaalTrial = (
	environment: unknown,
	input: Omit<Parameters<typeof startMaalTrial>[0], 'stripe' | 'productId'>
): Promise<SubscriptionProjectionWrite> =>
	startMaalTrial({
		...input,
		stripe: createStripeClient(environment),
		productId: stripeProductId(environment)
	});

export const attemptOnboardingTrial = async (
	environment: unknown,
	input: Parameters<typeof startConfiguredMaalTrial>[1]
): Promise<BillingCapability | null> => {
	const { repository, workosUserId, householdId, now } = input;
	try {
		const availability = await repository.trialClaimAvailability(workosUserId, householdId);
		if (availability !== 'available') {
			const [subscription, deletion] = await Promise.all([
				repository.subscription(householdId),
				repository.deletionRequest(householdId)
			]);
			return subscription?.status === 'trialing' &&
				subscription.subscriberUserId === workosUserId &&
				deletionAllowsProjectedSubscription(deletion, subscription)
				? projectBillingCapability(subscription, now)
				: null;
		}
		return projectBillingCapability(await startConfiguredMaalTrial(environment, input), now);
	} catch (cause) {
		if (!(cause instanceof TrialUnavailableError)) logOnboardingTrialFailure(cause);
		return null;
	}
};

export const logOnboardingTrialFailure = (cause: unknown): void => {
	console.error(
		'Failed to start household trial after creation',
		cause instanceof Error ? cause.constructor.name : 'unknown'
	);
};

export const startMaalTrial = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	productId: string;
	householdId: string;
	workosUserId: string;
	email: string;
	priceId?: string;
	now: string;
}): Promise<SubscriptionProjectionWrite> => {
	await assertTrialAvailable(input.repository, input.workosUserId, input.householdId);
	const { stripe, productId } = input;
	const price = input.priceId
		? await requireMaalPrice(stripe, productId, input.priceId)
		: (
				await stripe.prices.list({
					product: productId,
					active: true,
					lookup_keys: [MAAL_PRICE_LOOKUP_KEYS.month]
				})
			).data.find((candidate) => decodeMaalPrice(candidate, productId)?.interval === 'month');
	if (!price?.recurring?.trial_period_days) throw new TrialConfigurationError();
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
		await assertTrialAvailable(input.repository, input.workosUserId, input.householdId);
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
		await input.repository.recordTrialResources({
			id: claimId,
			stripeCustomerId: customerId,
			stripeSubscriptionId: null,
			updatedAt: input.now
		});
		const subscription = await input.stripe.subscriptions.create(
			{
				customer: customer.id,
				items: [{ price: price.id }],
				metadata: { householdId: input.householdId, workosUserId: input.workosUserId },
				trial_from_plan: true,
				trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }
			},
			{ idempotencyKey: `maal-trial-subscription:${claimId}` }
		);
		subscriptionId = subscription.id;
		await input.repository.recordTrialResources({
			id: claimId,
			stripeCustomerId: customerId,
			stripeSubscriptionId: subscriptionId,
			updatedAt: input.now
		});
		if (subscription.status !== 'trialing') throw new TrialConfigurationError();
		const projection = projectionFromStripeSubscription({
			subscription,
			householdId: input.householdId,
			subscriberUserId: input.workosUserId,
			eventId: `trial:${claimId}`,
			eventCreatedAt: input.now,
			existing: null,
			paidPeriodSucceeded: false,
			reportsStatus: true
		});
		await input.repository.commitStartedTrial({
			claimId,
			startedAt: input.now,
			projection
		});
		return projection;
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
		if (subscriptionId && subscriptionRemoved && customerRemoved) {
			await input.repository.completeTrialRollback(claimId, input.now);
		} else if (subscriptionRemoved && customerRemoved) {
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
		super('The Maal price must have a trial configured in Stripe.');
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
