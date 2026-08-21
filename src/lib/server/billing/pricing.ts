import type Stripe from 'stripe';

import type { BillingPrice, BillingPriceInterval } from '$lib/domain/billing/contracts.js';

export const MAAL_PRICE_LOOKUP_KEYS = {
	week: 'maal_weekly_v1',
	month: 'maal_monthly_v1',
	year: 'maal_yearly_v1'
} as const satisfies Record<BillingPriceInterval, string>;

const supportedInterval = (value: string): value is BillingPriceInterval =>
	value === 'week' || value === 'month' || value === 'year';

export const decodeMaalPrice = (price: Stripe.Price, productId: string): BillingPrice | null => {
	const priceProductId = typeof price.product === 'string' ? price.product : price.product.id;
	if (
		!price.active ||
		priceProductId !== productId ||
		price.type !== 'recurring' ||
		price.billing_scheme !== 'per_unit' ||
		price.recurring?.usage_type !== 'licensed' ||
		!supportedInterval(price.recurring.interval) ||
		price.unit_amount === null ||
		price.unit_amount <= 0 ||
		price.lookup_key !== MAAL_PRICE_LOOKUP_KEYS[price.recurring.interval]
	) {
		return null;
	}
	return {
		id: price.id,
		lookupKey: price.lookup_key,
		amountMinor: price.unit_amount,
		currency: price.currency,
		interval: price.recurring.interval,
		intervalCount: price.recurring.interval_count
	};
};

export const listMaalPrices = async (stripe: Stripe, productId: string): Promise<BillingPrice[]> => {
	const page = await stripe.prices.list({ product: productId, active: true, limit: 100 });
	const prices = page.data
		.map((price) => decodeMaalPrice(price, productId))
		.filter((price): price is BillingPrice => price !== null)
		.sort((left, right) => ['week', 'month', 'year'].indexOf(left.interval) - ['week', 'month', 'year'].indexOf(right.interval));
	return prices;
};

export const requireMaalPrice = async (
	stripe: Stripe,
	productId: string,
	priceId: string
): Promise<BillingPrice> => {
	const price = decodeMaalPrice(await stripe.prices.retrieve(priceId), productId);
	if (!price) throw new BillingPriceRejected();
	return price;
};

export class BillingPriceRejected extends Error {
	readonly _tag = 'BillingPriceRejected';
	constructor() {
		super('Choose a current weekly, monthly, or yearly Maal price.');
	}
}
