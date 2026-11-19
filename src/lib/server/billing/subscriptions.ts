import type Stripe from 'stripe';

import { graceWindowForStatus, projectBillingCapability } from '$lib/domain/billing/capability.js';
import type {
	BillingProjectionEnvelope,
	StripeSubscriptionStatus
} from '$lib/domain/billing/contracts.js';

import { BillingConflictError, TrialUnavailableError } from './errors.js';
import { listMaalPrices } from './pricing.js';
import type {
	BillingRepository,
	BillingSubscriptionRow,
	HouseholdDeletionRow,
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

/**
 * Projects a live Stripe subscription into the D1 row. Grace windows start at the Stripe event's
 * creation time, so webhook outages and retries never lengthen grace.
 */
export const projectionFromStripeSubscription = (input: {
	subscription: Stripe.Subscription;
	householdId: string;
	subscriberUserId: string | null;
	eventId: string;
	eventCreatedAt: string;
	existing: BillingSubscriptionRow | null;
	paidPeriodSucceeded: boolean;
	/** Subscription events report the status at event time; invoice events do not. */
	reportsStatus: boolean;
}): SubscriptionProjectionWrite => {
	const customerId = stringId(input.subscription.customer);
	const priceId = subscriptionPriceId(input.subscription);
	const currentPeriodEnd = subscriptionPeriodEnd(input.subscription);
	if (!customerId || !priceId || !currentPeriodEnd) throw new BillingProjectionError();
	const status = effectiveStripeStatus(input.subscription);
	const sameSubscription = input.existing?.stripeSubscriptionId === input.subscription.id;
	// An interruption that began at or before the last successful payment is over, so a paid
	// event delivered before its failure event cannot anchor the new grace window.
	const priorInterruption = sameSubscription
		? (input.existing?.interruptionStartedAt ?? null)
		: null;
	const interruptionIsOver =
		// An event that reports no subscription status (an invoice) cannot restart the window;
		// it keeps the current — possibly provisional payment-time — start until a snapshot lands.
		input.reportsStatus &&
		priorInterruption !== null &&
		input.existing?.lastSuccessfulPaymentAt != null &&
		priorInterruption <= input.existing.lastSuccessfulPaymentAt;
	const grace = graceWindowForStatus(
		status,
		interruptionIsOver ? null : priorInterruption,
		input.eventCreatedAt,
		// A paid invoice for an earlier period does not end an interruption Stripe still reports.
		input.paidPeriodSucceeded && (status === 'active' || status === 'trialing')
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
		status,
		currentPeriodEnd,
		cancelAtPeriodEnd: input.subscription.cancel_at_period_end,
		...grace,
		lastSuccessfulPaymentAt: input.paidPeriodSucceeded
			? input.eventCreatedAt
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
	const alreadySubscribed =
		capability.state !== 'disabled' || householdHasOpenSubscription(subscription, deletion);
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

/** Stripe never bills or revives a subscription in these statuses. */
const TERMINAL_SUBSCRIPTION_STATUSES: ReadonlySet<StripeSubscriptionStatus> = new Set([
	'canceled',
	'incomplete_expired'
]);

export const subscriptionIsOpen = (status: StripeSubscriptionStatus): boolean =>
	!TERMINAL_SUBSCRIPTION_STATUSES.has(status);

/**
 * Whether the projected subscription can still bill or be paid back to life. A household has at
 * most one such subscription; lapsed ones are resumed through the portal, never replaced.
 */
const householdHasOpenSubscription = (
	subscription: BillingSubscriptionRow | null,
	deletion: HouseholdDeletionRow | null
): boolean =>
	subscription !== null &&
	subscriptionIsOpen(subscription.status) &&
	deletionAllowsProjectedSubscription(deletion, subscription);

/** Every subscription Stripe holds for the customer that can still bill. */
export const openStripeSubscriptions = async (
	stripe: Stripe,
	customerId: string
): Promise<readonly Stripe.Subscription[]> =>
	(
		await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
	).data.filter((subscription) => subscriptionIsOpen(subscription.status));

export const assertTrialAvailable = async (
	repository: BillingRepository,
	workosUserId: string,
	householdId: string
): Promise<void> => {
	const [subscription, deletion] = await Promise.all([
		repository.subscription(householdId),
		repository.deletionRequest(householdId)
	]);
	if (deletion !== null && deletion.state !== 'recovered') {
		throw new BillingConflictError('household_deletion_pending');
	}
	if (householdHasOpenSubscription(subscription, deletion)) {
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
