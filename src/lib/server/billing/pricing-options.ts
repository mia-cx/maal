import type Stripe from 'stripe';

export type PricingOption = {
	id: string;
	label: 'Trial' | 'Weekly' | 'Monthly' | 'Yearly';
	amount: number;
	currency: string;
	interval: 'week' | 'month' | 'year';
	intervalCount: number;
};

export type SupportedFixedRecurringPrice = Stripe.Price & {
	unit_amount: number;
	recurring: Stripe.Price.Recurring;
};

const optionLabel = (price: Stripe.Price): PricingOption['label'] | null => {
	if (price.unit_amount === 0) return 'Trial';
	if (price.recurring?.interval === 'week') return 'Weekly';
	if (price.recurring?.interval === 'month') return 'Monthly';
	if (price.recurring?.interval === 'year') return 'Yearly';
	return null;
};

export const supportedInterval = (
	interval: Stripe.Price.Recurring.Interval
): PricingOption['interval'] | null => {
	if (interval === 'week' || interval === 'month' || interval === 'year') return interval;
	return null;
};

export const isSupportedFixedRecurringPrice = (
	price: Stripe.Price
): price is SupportedFixedRecurringPrice =>
	price.active &&
	price.type === 'recurring' &&
	price.billing_scheme === 'per_unit' &&
	price.recurring?.usage_type === 'licensed' &&
	price.unit_amount !== null &&
	Number.isFinite(price.unit_amount) &&
	Boolean(price.recurring && supportedInterval(price.recurring.interval));

const optionOrder = new Map<PricingOption['label'], number>([
	['Weekly', 1],
	['Monthly', 2],
	['Yearly', 3],
	['Trial', 4]
]);

const trialDefaultOrder = new Map<PricingOption['interval'], number>([
	['month', 1],
	['week', 2],
	['year', 3]
]);

const priceProductId = (price: Stripe.Price): string | null => {
	if (typeof price.product === 'string') return price.product;
	if (price.product && !price.product.deleted) return price.product.id;
	return null;
};

export const priceToPricingOption = (price: Stripe.Price): PricingOption | null => {
	if (!isSupportedFixedRecurringPrice(price)) return null;
	const label = optionLabel(price);
	const interval = supportedInterval(price.recurring.interval);
	if (!label || !interval) return null;
	return {
		id: price.id,
		label,
		amount: price.unit_amount,
		currency: price.currency,
		interval,
		intervalCount: price.recurring.interval_count
	};
};

export const pricingOptionsFromPrices = (prices: Stripe.Price[]): PricingOption[] =>
	prices
		.map(priceToPricingOption)
		.filter((option): option is PricingOption => Boolean(option))
		.sort(
			(left, right) => (optionOrder.get(left.label) ?? 99) - (optionOrder.get(right.label) ?? 99)
		);

export const pricingOptionForProductPrice = (
	price: Stripe.Price,
	productId: string
): PricingOption | null => {
	if (priceProductId(price) !== productId) return null;
	return priceToPricingOption(price);
};

export const paidRecurringPricingOptionsForProduct = (
	prices: Stripe.Price[],
	productId: string
): PricingOption[] =>
	prices
		.map((price) => pricingOptionForProductPrice(price, productId))
		.filter((option): option is PricingOption => option !== null && option.amount > 0);

export const trialDefaultPricingOptionFromPrices = (
	prices: Stripe.Price[],
	productId: string
): PricingOption | null =>
	paidRecurringPricingOptionsForProduct(prices, productId).sort(
		(left, right) =>
			(trialDefaultOrder.get(left.interval) ?? 99) - (trialDefaultOrder.get(right.interval) ?? 99)
	)[0] ?? null;
