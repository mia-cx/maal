import type Stripe from 'stripe';

export type PricingOption = {
	id: string;
	label: 'Trial' | 'Weekly' | 'Monthly' | 'Yearly';
	amount: number;
	currency: string;
	interval: 'week' | 'month' | 'year';
	intervalCount: number;
};

const optionLabel = (price: Stripe.Price): PricingOption['label'] | null => {
	if (price.unit_amount === 0) return 'Trial';
	if (price.recurring?.interval === 'week') return 'Weekly';
	if (price.recurring?.interval === 'month') return 'Monthly';
	if (price.recurring?.interval === 'year') return 'Yearly';
	return null;
};

const supportedInterval = (
	interval: Stripe.Price.Recurring.Interval
): PricingOption['interval'] | null => {
	if (interval === 'week' || interval === 'month' || interval === 'year') return interval;
	return null;
};

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
	const label = optionLabel(price);
	const interval = price.recurring ? supportedInterval(price.recurring.interval) : null;
	if (!price.active || price.type !== 'recurring' || !label || !price.recurring || !interval) {
		return null;
	}
	const amount = price.unit_amount;
	if (amount === null || !Number.isFinite(amount)) return null;
	return {
		id: price.id,
		label,
		amount,
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
		.filter((option): option is PricingOption => Boolean(option) && option.amount > 0);

export const trialDefaultPricingOptionFromPrices = (
	prices: Stripe.Price[],
	productId: string
): PricingOption | null =>
	paidRecurringPricingOptionsForProduct(prices, productId).sort(
		(left, right) =>
			(trialDefaultOrder.get(left.interval) ?? 99) -
			(trialDefaultOrder.get(right.interval) ?? 99)
	)[0] ?? null;
