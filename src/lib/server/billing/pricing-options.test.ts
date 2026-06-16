import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	pricingOptionForProductPrice,
	pricingOptionsFromPrices,
	trialDefaultPricingOptionFromPrices
} from './pricing-options';

const price = (overrides: Partial<Stripe.Price>): Stripe.Price =>
	({
		id: 'price_1',
		type: 'recurring',
		active: true,
		unit_amount: 100,
		currency: 'gbp',
		product: 'prod_maal',
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

	it('drops inactive, one-time, and unsupported recurring prices', () => {
		expect(
			pricingOptionsFromPrices([
				price({ active: false }),
				price({ type: 'one_time', recurring: null }),
				price({ recurring: { interval: 'day', interval_count: 1 } as Stripe.Price.Recurring })
			])
		).toEqual([]);
	});

	it('preserves recurring interval count and drops nullable amount prices', () => {
		expect(
			pricingOptionsFromPrices([
				price({
					id: 'monthly-every-two',
					unit_amount: 800,
					recurring: { interval: 'month', interval_count: 2 } as Stripe.Price.Recurring
				}),
				price({ id: 'metered', unit_amount: null })
			])
		).toEqual([
			{
				id: 'monthly-every-two',
				label: 'Monthly',
				amount: 800,
				currency: 'gbp',
				interval: 'month',
				intervalCount: 2
			}
		]);
	});

	it('selects only valid active recurring pricing options for the configured product', () => {
		expect(pricingOptionForProductPrice(price({ id: 'selected' }), 'prod_maal')?.id).toBe(
			'selected'
		);
		expect(
			pricingOptionForProductPrice(price({ id: 'wrong', product: 'prod_other' }), 'prod_maal')
		).toBeNull();
		expect(
			pricingOptionForProductPrice(price({ id: 'inactive', active: false }), 'prod_maal')
		).toBeNull();
	});

	it('uses the shared paid recurring policy for trial defaults', () => {
		expect(
			trialDefaultPricingOptionFromPrices(
				[
					price({ id: 'free-weekly', unit_amount: 0 }),
					price({ id: 'yearly', recurring: { interval: 'year', interval_count: 1 } as Stripe.Price.Recurring }),
					price({ id: 'monthly', recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring }),
					price({ id: 'wrong-product', product: 'prod_other' })
				],
				'prod_maal'
			)?.id
		).toBe('monthly');
	});
});
