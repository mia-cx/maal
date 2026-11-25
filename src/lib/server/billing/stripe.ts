import Stripe from 'stripe';

interface StripeEnvironment {
	readonly STRIPE_SECRET_KEY?: string;
	readonly STRIPE_WEBHOOK_SECRET?: string;
	readonly STRIPE_PRODUCT_ID?: string;
	readonly MAAL_TRIAL_DAYS?: string;
}

const valueFrom = (environment: unknown, key: keyof StripeEnvironment): string | undefined =>
	(environment as StripeEnvironment | undefined)?.[key] ?? process.env[key];

export const createStripeClient = (environment?: unknown): Stripe => {
	const secretKey = valueFrom(environment, 'STRIPE_SECRET_KEY');
	if (!secretKey) throw new BillingConfigurationError('STRIPE_SECRET_KEY');
	return new Stripe(secretKey, {
		apiVersion: '2026-06-24.dahlia',
		httpClient: Stripe.createFetchHttpClient(),
		maxNetworkRetries: 2
	});
};

export const stripeProductId = (environment?: unknown): string => {
	const productId = valueFrom(environment, 'STRIPE_PRODUCT_ID');
	if (!productId) throw new BillingConfigurationError('STRIPE_PRODUCT_ID');
	return productId;
};

export const stripeWebhookSecret = (environment?: unknown): string => {
	const secret = valueFrom(environment, 'STRIPE_WEBHOOK_SECRET');
	if (!secret) throw new BillingConfigurationError('STRIPE_WEBHOOK_SECRET');
	return secret;
};

export const configuredTrialDays = (environment?: unknown): number => {
	const configured = Number.parseInt(valueFrom(environment, 'MAAL_TRIAL_DAYS') ?? '30', 10);
	return Number.isSafeInteger(configured) && configured > 0 && configured <= 90 ? configured : 30;
};

export class BillingConfigurationError extends Error {
	readonly _tag = 'BillingConfigurationError';
	constructor(readonly setting: string) {
		super(`Billing setting ${setting} is unavailable.`);
	}
}
