import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { landingPricingFallback, paidLandingPrice, trialPriceIdFromPrices } from './+page.server';

const price = (overrides: Partial<Stripe.Price>): Stripe.Price =>
	({
		id: 'price_1',
		type: 'recurring',
		active: true,
		unit_amount: 500,
		currency: 'gbp',
		billing_scheme: 'per_unit',
		recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
		...overrides
	}) as Stripe.Price;

describe('paidLandingPrice', () => {
	it('projects fixed recurring paid prices', () => {
		expect(paidLandingPrice(price({ id: 'monthly' }))).toEqual({
			id: 'monthly',
			label: 'Monthly',
			amount: 500,
			currency: 'gbp',
			interval: 'month',
			intervalCount: 1
		});
	});

	it('skips free, nullable, tiered, metered, inactive, and one-time prices', () => {
		expect(paidLandingPrice(price({ unit_amount: 0 }))).toBeNull();
		expect(paidLandingPrice(price({ unit_amount: null }))).toBeNull();
		expect(paidLandingPrice(price({ billing_scheme: 'tiered' }))).toBeNull();
		expect(
			paidLandingPrice(
				price({
					recurring: {
						interval: 'month',
						interval_count: 1,
						usage_type: 'metered'
					} as Stripe.Price.Recurring
				})
			)
		).toBeNull();
		expect(paidLandingPrice(price({ active: false }))).toBeNull();
		expect(paidLandingPrice(price({ type: 'one_time', recurring: null }))).toBeNull();
	});
});

describe('trialPriceIdFromPrices', () => {
	it('selects only fixed recurring zero-amount trial prices', () => {
		expect(
			trialPriceIdFromPrices([
				price({ id: 'nullable', unit_amount: null }),
				price({
					id: 'metered-trial',
					unit_amount: 0,
					recurring: {
						interval: 'month',
						interval_count: 1,
						usage_type: 'metered'
					} as Stripe.Price.Recurring
				}),
				price({ id: 'trial', unit_amount: 0 })
			])
		).toBe('trial');
	});
});

describe('landingPricingFallback', () => {
	it('logs the cause and returns an explicit unavailable pricing state', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('stripe unavailable');

		expect(landingPricingFallback(cause)).toEqual({
			productName: 'Maal',
			pricing: [],
			pricingStatus: 'unavailable',
			trialPriceId: null,
			trialAvailable: false
		});
		expect(consoleError).toHaveBeenCalledWith('Failed to load landing pricing', cause);

		consoleError.mockRestore();
	});
});
