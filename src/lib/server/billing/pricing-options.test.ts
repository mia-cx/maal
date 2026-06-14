import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { pricingOptionsFromPrices } from './pricing-options';

const price = (overrides: Partial<Stripe.Price>): Stripe.Price =>
	({
		id: 'price_1',
		type: 'recurring',
		unit_amount: 100,
		currency: 'gbp',
		recurring: { interval: 'month', interval_count: 1 },
		...overrides
	}) as Stripe.Price;

describe('pricingOptionsFromPrices', () => {
	it('projects supported recurring prices in display order', () => {
		expect(
			pricingOptionsFromPrices([
				price({
					id: 'year',
					unit_amount: 1000,
					recurring: { interval: 'year', interval_count: 1 } as Stripe.Price.Recurring
				}),
				price({
					id: 'trial',
					unit_amount: 0,
					recurring: { interval: 'week', interval_count: 1 } as Stripe.Price.Recurring
				}),
				price({
					id: 'week',
					unit_amount: 100,
					recurring: { interval: 'week', interval_count: 1 } as Stripe.Price.Recurring
				}),
				price({
					id: 'month',
					unit_amount: 400,
					recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring
				})
			]).map((option) => option.label)
		).toEqual(['Weekly', 'Monthly', 'Yearly', 'Trial']);
	});

	it('drops one-time and unsupported recurring prices', () => {
		expect(
			pricingOptionsFromPrices([
				price({ type: 'one_time', recurring: null }),
				price({ recurring: { interval: 'day', interval_count: 1 } as Stripe.Price.Recurring })
			])
		).toEqual([]);
	});
});
