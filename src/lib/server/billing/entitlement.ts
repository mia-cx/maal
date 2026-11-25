import { STRIPE_RENEWAL_TOLERANCE_MILLISECONDS } from '$lib/domain/billing/capability.js';

/** The earliest projected period end that still enables an `active` or `trialing` row at `now`. */
export const renewalCutoff = (now: string): string =>
	new Date(Date.parse(now) - STRIPE_RENEWAL_TOLERANCE_MILLISECONDS).toISOString();

export interface ProjectedSubscriptionState {
	readonly status: string | null;
	readonly currentPeriodEnd: string | null;
	readonly graceUntil: string | null;
}

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
