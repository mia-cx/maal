import type { BillingCapability, StripeSubscriptionStatus } from '$lib/domain/billing/contracts.js';

export const BILLING_GRACE_DAYS = 30 as const;
export const BILLING_GRACE_MILLISECONDS = BILLING_GRACE_DAYS * 24 * 60 * 60 * 1_000;

export interface BillingProjectionInput {
	readonly householdId: string;
	readonly status: StripeSubscriptionStatus | null;
	readonly subscriberUserId: string | null;
	readonly stripePriceId: string | null;
	readonly currentPeriodEnd: string | null;
	readonly cancelAtPeriodEnd: boolean;
	readonly interruptionStartedAt: string | null;
	readonly graceUntil: string | null;
}

export const billingCapabilityWasPreviouslyPaid = (capability: BillingCapability): boolean =>
	capability.stripeStatus !== null ||
	capability.subscriberUserId !== null ||
	capability.stripePriceId !== null ||
	capability.currentPeriodEnd !== null ||
	capability.interruptionStartedAt !== null ||
	capability.graceUntil !== null;

export const billingCapabilityIsEnabledAt = (capability: BillingCapability, now: number): boolean =>
	capability.state !== 'disabled' &&
	capability.validUntil !== null &&
	now < Date.parse(capability.validUntil);

const asUtc = (milliseconds: number): `${string}Z` =>
	new Date(milliseconds).toISOString() as `${string}Z`;

export const graceWindowForStatus = (
	status: StripeSubscriptionStatus,
	previousInterruptionStartedAt: string | null,
	eventReceivedAt: string,
	paidPeriodSucceeded: boolean
): { interruptionStartedAt: string | null; graceUntil: string | null } => {
	if (paidPeriodSucceeded || (status === 'trialing' && previousInterruptionStartedAt === null)) {
		return { interruptionStartedAt: null, graceUntil: null };
	}
	if (status === 'active') {
		return {
			interruptionStartedAt: previousInterruptionStartedAt,
			graceUntil: previousInterruptionStartedAt
				? asUtc(Date.parse(previousInterruptionStartedAt) + BILLING_GRACE_MILLISECONDS)
				: null
		};
	}
	if (status !== 'past_due' && status !== 'paused') {
		return { interruptionStartedAt: previousInterruptionStartedAt, graceUntil: null };
	}
	const interruptionStartedAt = previousInterruptionStartedAt ?? eventReceivedAt;
	return {
		interruptionStartedAt,
		graceUntil: asUtc(Date.parse(interruptionStartedAt) + BILLING_GRACE_MILLISECONDS)
	};
};

export const projectBillingCapability = (
	input: BillingProjectionInput,
	now: string,
	stale = false
): BillingCapability => {
	const graceActive =
		(input.status === 'past_due' || input.status === 'paused') &&
		input.graceUntil !== null &&
		Date.parse(now) <= Date.parse(input.graceUntil);
	const enabled = input.status === 'active' || input.status === 'trialing';
	return {
		householdId: input.householdId,
		state: enabled ? 'enabled' : graceActive ? 'grace' : 'disabled',
		stripeStatus: input.status,
		subscriberUserId: input.subscriberUserId,
		stripePriceId: input.stripePriceId,
		currentPeriodEnd: input.currentPeriodEnd as `${string}Z` | null,
		interruptionStartedAt: input.interruptionStartedAt as `${string}Z` | null,
		graceUntil: input.graceUntil as `${string}Z` | null,
		validUntil: enabled
			? (input.currentPeriodEnd as `${string}Z` | null)
			: graceActive
				? (input.graceUntil as `${string}Z`)
				: null,
		cancelAtPeriodEnd: input.cancelAtPeriodEnd,
		stale,
		source: 'stripe-d1'
	};
};

export const stripeEventIsNewer = (
	incoming: { createdAt: string; id: string },
	current: { createdAt: string | null; id: string | null }
): boolean => {
	if (!current.createdAt) return true;
	const incomingTime = Date.parse(incoming.createdAt);
	const currentTime = Date.parse(current.createdAt);
	if (incomingTime !== currentTime) return incomingTime > currentTime;
	return incoming.id.localeCompare(current.id ?? '') > 0;
};
