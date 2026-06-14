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

export const priceToPricingOption = (price: Stripe.Price): PricingOption | null => {
	const label = optionLabel(price);
	const interval = price.recurring ? supportedInterval(price.recurring.interval) : null;
	if (!label || !price.recurring || !interval) return null;
	return {
		id: price.id,
		label,
		amount: price.unit_amount ?? 0,
		currency: price.currency,
		interval,
		intervalCount: price.recurring.interval_count
	};
};

export const pricingOptionsFromPrices = (prices: Stripe.Price[]): PricingOption[] =>
	prices
		.filter((price) => price.type === 'recurring' && price.recurring)
		.map(priceToPricingOption)
		.filter((option): option is PricingOption => Boolean(option))
		.sort(
			(left, right) => (optionOrder.get(left.label) ?? 99) - (optionOrder.get(right.label) ?? 99)
		);
