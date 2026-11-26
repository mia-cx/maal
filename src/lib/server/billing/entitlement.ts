import { STRIPE_RENEWAL_TOLERANCE_MILLISECONDS } from '$lib/domain/billing/capability.js';

/** The earliest projected period end that still enables an `active` or `trialing` row at `now`. */
export const renewalCutoff = (now: string): string =>
	new Date(Date.parse(now) - STRIPE_RENEWAL_TOLERANCE_MILLISECONDS).toISOString();

export interface ProjectedSubscriptionState {
	readonly status: string | null;
	readonly currentPeriodEnd: string | null;
	readonly graceUntil: string | null;
}

export interface HouseholdRemoteServiceState extends ProjectedSubscriptionState {
	readonly stripeSubscriptionId: string | null;
	readonly deletionState: string | null;
	readonly stripeCancellationId: string | null;
}

/**
 * Whether a member gets remote service (sync, MCP, remote compute) in a household at `now`.
 *
 * `billingGrant` is the member's live WorkOS metadata grant (`LiveWorkOSMembership.billingGrant`),
 * which stands in for the Stripe plan. A deletion in progress turns remote service off either way;
 * after a recovery, a paid household needs a subscription other than the one deletion cancelled.
 */
export const householdEnablesRemoteService = (
	household: HouseholdRemoteServiceState,
	billingGrant: boolean,
	now: string
): boolean => {
	if (billingGrant)
		return household.deletionState === null || household.deletionState === 'recovered';
	const deletionAllows =
		household.deletionState === null ||
		(household.deletionState === 'recovered' &&
			household.stripeSubscriptionId !== null &&
			household.stripeSubscriptionId !== household.stripeCancellationId);
	return deletionAllows && subscriptionEnablesRemoteService(household, now);
};

/** Whether the D1 billing projection enables remote service (sync, MCP) at `now`. */
export const subscriptionEnablesRemoteService = (
	subscription: ProjectedSubscriptionState,
	now: string
): boolean =>
	((subscription.status === 'active' || subscription.status === 'trialing') &&
		subscription.currentPeriodEnd !== null &&
		subscription.currentPeriodEnd > renewalCutoff(now)) ||
	((subscription.status === 'past_due' || subscription.status === 'paused') &&
		subscription.graceUntil !== null &&
		subscription.graceUntil > now);
