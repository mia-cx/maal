import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	pricingOptionForProductPrice,
	pricingOptionsFromPrices,
	trialDefaultPricingOptionFromPrices
} from './pricing-options';

const recurring = (interval: Stripe.Price.Recurring.Interval, intervalCount = 1) =>
	({ interval, interval_count: intervalCount, usage_type: 'licensed' }) satisfies Pick<
		Stripe.Price.Recurring,
		'interval' | 'interval_count' | 'usage_type'
	>;

type RecurringOverride = Pick<
	Stripe.Price.Recurring,
	'interval' | 'interval_count' | 'usage_type'
>;

type PriceOverrides = Omit<Partial<Stripe.Price>, 'recurring'> & {
	recurring?: RecurringOverride | null;
};

const price = (overrides: PriceOverrides): Stripe.Price =>
	({
		id: 'price_1',
		type: 'recurring',
		active: true,
		unit_amount: 100,
		currency: 'gbp',
		product: 'prod_maal',
		billing_scheme: 'per_unit',
		recurring: recurring('month'),
		...overrides
	}) as Stripe.Price;

describe('pricingOptionsFromPrices', () => {
	it('projects supported recurring prices in display order', () => {
		expect(
			pricingOptionsFromPrices([
				price({ id: 'year', unit_amount: 1000, recurring: recurring('year') }),
				price({ id: 'trial', unit_amount: 0, recurring: recurring('week') }),
				price({ id: 'week', unit_amount: 100, recurring: recurring('week') }),
				price({ id: 'month', unit_amount: 400, recurring: recurring('month') })
			]).map((option) => option.label)
		).toEqual(['Weekly', 'Monthly', 'Yearly', 'Trial']);
	});

	it('drops inactive, one-time, metered, tiered, and unsupported recurring prices', () => {
		expect(
			pricingOptionsFromPrices([
				price({ active: false }),
				price({ type: 'one_time', recurring: null }),
				price({ billing_scheme: 'tiered' }),
				price({ recurring: { ...recurring('month'), usage_type: 'metered' } }),
				price({ recurring: recurring('day') })
			])
		).toEqual([]);
	});

	it('preserves recurring interval count and drops nullable amount prices', () => {
		expect(
			pricingOptionsFromPrices([
				price({ id: 'monthly-every-two', unit_amount: 800, recurring: recurring('month', 2) }),
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
					price({ id: 'yearly', recurring: recurring('year') }),
					price({ id: 'monthly', recurring: recurring('month') }),
					price({ id: 'wrong-product', product: 'prod_other' })
				],
				'prod_maal'
			)?.id
		).toBe('monthly');
	});
});
