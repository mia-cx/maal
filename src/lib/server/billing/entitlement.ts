/**
 * How long an `active`/`trialing` row stays enabled past its projected `current_period_end`.
 *
 * At renewal Stripe advances the period and creates the invoice, then waits about an hour before
 * it attempts payment, so the subscription legitimately stays `active` while D1 still holds the
 * old period end until `customer.subscription.updated` lands. A failed payment after that hour
 * moves the row to `past_due`, which has its own grace window.
 */
export const STRIPE_RENEWAL_TOLERANCE_MILLISECONDS = 60 * 60 * 1_000;

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
