import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import Stripe from 'stripe';

interface StripeEnv {
	STRIPE_SECRET_KEY?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	STRIPE_PRICING_TABLE_ID?: string;
	STRIPE_PRODUCT_ID?: string;
	PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
}

const stripeApiVersion = '2026-05-27.dahlia';

const readPrivate = (
	platformEnv: StripeEnv | undefined,
	key: keyof StripeEnv
): string | undefined => platformEnv?.[key] ?? privateEnv[key];

const readPublicStripePublishableKey = (platformEnv: StripeEnv | undefined): string | undefined =>
	platformEnv?.PUBLIC_STRIPE_PUBLISHABLE_KEY ?? publicEnv.PUBLIC_STRIPE_PUBLISHABLE_KEY;

export const createStripeClient = (platform?: App.Platform): Stripe => {
	const secretKey = readPrivate(platform?.env, 'STRIPE_SECRET_KEY');
	if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set');

	return new Stripe(secretKey, {
		apiVersion: stripeApiVersion,
		httpClient: Stripe.createFetchHttpClient()
	});
};

export const getStripeWebhookSecret = (platform?: App.Platform): string => {
	const secret = readPrivate(platform?.env, 'STRIPE_WEBHOOK_SECRET');
	if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
	return secret;
};

export const getStripePublicConfig = (platform?: App.Platform) => ({
	publishableKey: readPublicStripePublishableKey(platform?.env) ?? '',
	pricingTableId: readPrivate(platform?.env, 'STRIPE_PRICING_TABLE_ID') ?? '',
	productId: readPrivate(platform?.env, 'STRIPE_PRODUCT_ID') ?? ''
});

export const getStripeProductId = (platform?: App.Platform): string => {
	const productId = readPrivate(platform?.env, 'STRIPE_PRODUCT_ID');
	if (!productId) throw new Error('STRIPE_PRODUCT_ID is not set');
	return productId;
};

export const currentPeriodEndIso = (subscription: Stripe.Subscription): string | null => {
	const periodEnd = subscription.items.data[0]?.current_period_end;
	return periodEnd == null ? null : new Date(periodEnd * 1000).toISOString();
};

export const subscriptionPriceId = (subscription: Stripe.Subscription): string | null =>
	subscription.items.data[0]?.price.id ?? null;
