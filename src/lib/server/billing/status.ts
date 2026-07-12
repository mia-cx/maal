export const billingStatusValues = [
	'active',
	'canceled',
	'incomplete',
	'incomplete_expired',
	'past_due',
	'paused',
	'trialing',
	'unpaid',
	'unknown'
] as const;

export type BillingStatus = (typeof billingStatusValues)[number];

export const paidBillingStatuses = new Set<BillingStatus>(['active', 'trialing']);

export const billingStatusFromStripe = (status: string | null | undefined): BillingStatus =>
	billingStatusValues.includes(status as BillingStatus) ? (status as BillingStatus) : 'unknown';
