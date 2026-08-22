import type Stripe from 'stripe';

import { graceWindowForStatus, projectBillingCapability } from '$lib/domain/billing/capability.js';
import type {
	BillingProjectionEnvelope,
	StripeSubscriptionStatus
} from '$lib/domain/billing/contracts.js';

import { TrialUnavailableError } from './errors.js';
import { listMaalPrices } from './pricing.js';
import type {
	BillingRepository,
	BillingSubscriptionRow,
	SubscriptionProjectionWrite
} from './repository.js';
import { deletionAllowsProjectedSubscription } from './subscription-identity.js';

const utcFromSeconds = (seconds: number): `${string}Z` =>
	new Date(seconds * 1_000).toISOString() as `${string}Z`;

const stringId = (value: string | { id: string } | null): string | null =>
	value === null ? null : typeof value === 'string' ? value : value.id;

export const effectiveStripeStatus = (
	subscription: Stripe.Subscription
): StripeSubscriptionStatus => (subscription.pause_collection ? 'paused' : subscription.status);

export const subscriptionPriceId = (subscription: Stripe.Subscription): string | null =>
	subscription.items.data[0]?.price.id ?? null;

export const subscriptionPeriodEnd = (subscription: Stripe.Subscription): string | null => {
	const end = subscription.items.data
		.map((item) => item.current_period_end)
		.sort((a, b) => b - a)[0];
	return end === undefined ? null : utcFromSeconds(end);
};

export const projectionFromStripeSubscription = (input: {
	subscription: Stripe.Subscription;
	householdId: string;
	subscriberUserId: string | null;
	eventId: string;
	eventCreatedAt: string;
	eventReceivedAt: string;
	existing: BillingSubscriptionRow | null;
	paidPeriodSucceeded: boolean;
}): SubscriptionProjectionWrite => {
	const customerId = stringId(input.subscription.customer);
	const priceId = subscriptionPriceId(input.subscription);
	const currentPeriodEnd = subscriptionPeriodEnd(input.subscription);
	if (!customerId || !priceId || !currentPeriodEnd) throw new BillingProjectionError();
	const sameSubscription = input.existing?.stripeSubscriptionId === input.subscription.id;
	const grace = graceWindowForStatus(
		effectiveStripeStatus(input.subscription),
		sameSubscription ? (input.existing?.interruptionStartedAt ?? null) : null,
		input.eventReceivedAt,
		input.paidPeriodSucceeded
	);
	return {
		householdId: input.householdId,
		stripeCustomerId: customerId,
		stripeSubscriptionId: input.subscription.id,
		stripePriceId: priceId,
		subscriberUserId:
			input.subscription.metadata.workosUserId ||
			input.subscriberUserId ||
			input.existing?.subscriberUserId ||
			null,
		status: effectiveStripeStatus(input.subscription),
		currentPeriodEnd,
		cancelAtPeriodEnd: input.subscription.cancel_at_period_end,
		...grace,
		lastSuccessfulPaymentAt: input.paidPeriodSucceeded
			? input.eventReceivedAt
			: (input.existing?.lastSuccessfulPaymentAt ?? null),
		eventId: input.eventId,
		eventCreatedAt: input.eventCreatedAt
	};
};

export const loadBillingProjection = async (input: {
	repository: BillingRepository;
	stripe: Stripe;
	productId: string;
	householdId: string;
	workosUserId: string;
	now: string;
}): Promise<BillingProjectionEnvelope> => {
	const [subscription, availability, prices] = await Promise.all([
		input.repository.subscription(input.householdId),
		input.repository.trialClaimAvailability(input.workosUserId, input.householdId),
		listMaalPrices(input.stripe, input.productId)
	]);
	let capability = projectBillingCapability(
		{
			householdId: input.householdId,
			status: subscription?.status ?? null,
			subscriberUserId: subscription?.subscriberUserId ?? null,
			stripePriceId: subscription?.stripePriceId ?? null,
			currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
			cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
			interruptionStartedAt: subscription?.interruptionStartedAt ?? null,
			graceUntil: subscription?.graceUntil ?? null
		},
		input.now
	);
	const deletion = await input.repository.deletionRequest(input.householdId);
	if (!deletionAllowsProjectedSubscription(deletion, subscription)) {
		capability = { ...capability, state: 'disabled', validUntil: null };
	}
	const alreadySubscribed = capability.state !== 'disabled';
	return {
		schemaVersion: 1,
		capability,
		prices,
		trialAvailable: !alreadySubscribed && availability === 'available',
		trialUnavailableReason: alreadySubscribed
			? 'already_subscribed'
			: availability === 'available'
				? null
				: availability,
		refreshedAt: input.now as `${string}Z`
	};
};

export const assertTrialAvailable = async (
	repository: BillingRepository,
	workosUserId: string,
	householdId: string,
	now: string
): Promise<void> => {
	const subscription = await repository.subscription(householdId);
	if (
		subscription &&
		projectBillingCapability(
			{
				householdId,
				status: subscription.status,
				subscriberUserId: subscription.subscriberUserId,
				stripePriceId: subscription.stripePriceId,
				currentPeriodEnd: subscription.currentPeriodEnd,
				cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
				interruptionStartedAt: subscription.interruptionStartedAt,
				graceUntil: subscription.graceUntil
			},
			now
		).state !== 'disabled'
	) {
		throw new TrialUnavailableError('already_subscribed');
	}
	const availability = await repository.trialClaimAvailability(workosUserId, householdId);
	if (availability !== 'available') throw new TrialUnavailableError(availability);
};

export class BillingProjectionError extends Error {
	readonly _tag = 'BillingProjectionError';
	constructor() {
		super('Stripe returned an incomplete subscription projection.');
	}
}
