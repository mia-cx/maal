import { json } from '@sveltejs/kit';

export const billingErrorResponse = (cause: unknown): Response => {
	const tag =
		typeof cause === 'object' && cause !== null && '_tag' in cause && typeof cause._tag === 'string'
			? cause._tag
			: 'BillingUnavailable';
	const reason =
		typeof cause === 'object' &&
		cause !== null &&
		'reason' in cause &&
		typeof cause.reason === 'string'
			? cause.reason
			: undefined;
	const status =
		tag === 'BillingRequestError' ||
		tag === 'BillingPriceRejected' ||
		tag === 'StripeWebhookSignatureError'
			? 400
			: tag === 'BillingAuthorizationError'
				? reason === 'reauth_required'
					? 401
					: reason === 'storage_unavailable'
						? 503
						: 403
				: tag === 'BillingConflictError' || tag === 'TrialUnavailableError'
					? 409
					: tag === 'BillingConfigurationError' || tag === 'TrialConfigurationError'
						? 503
						: 502;
	return json({ error: { _tag: tag, ...(reason ? { reason } : {}) } }, { status });
};

export class BillingConflictError extends Error {
	readonly _tag = 'BillingConflictError';
	constructor(readonly reason: string) {
		super(reason);
	}
}

export class TrialUnavailableError extends Error {
	readonly _tag = 'TrialUnavailableError';
	constructor(
		readonly reason: 'user_already_claimed' | 'household_already_claimed' | 'already_subscribed'
	) {
		super(reason);
	}
}
