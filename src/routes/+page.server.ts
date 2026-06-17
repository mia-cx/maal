import type Stripe from 'stripe';
import type { PageServerLoad } from './$types';
import { resolveActiveHouseholdId } from '$lib/server/auth/household';
import {
	isSupportedFixedRecurringPrice,
	supportedInterval,
	trialDefaultPricingOptionFromPrices
} from '$lib/server/billing/pricing-options';
import { createStripeClient, getStripePublicConfig } from '$lib/server/domains/billing';
import { loadTrialAvailability } from '$lib/server/domains/billing';

export type LandingPrice = {
	id: string;
	label: 'Weekly' | 'Monthly' | 'Yearly';
	amount: number;
	currency: string;
	interval: 'week' | 'month' | 'year';
	intervalCount: number;
	supportsTrial?: boolean;
	trialPriceId?: string | null;
};

const labelFor = (price: Stripe.Price): LandingPrice['label'] | null => {
	if (price.unit_amount === 0) return null;
	if (price.recurring?.interval === 'week') return 'Weekly';
	if (price.recurring?.interval === 'month') return 'Monthly';
	if (price.recurring?.interval === 'year') return 'Yearly';
	return null;
};

const priceOrder = new Map<LandingPrice['label'], number>([
	['Weekly', 1],
	['Monthly', 2],
	['Yearly', 3]
]);

export const _paidLandingPrice = (price: Stripe.Price): LandingPrice | null => {
	if (!isSupportedFixedRecurringPrice(price)) return null;
	const label = labelFor(price);
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

export const _trialPriceIdFromPrices = (prices: Stripe.Price[]): string | null =>
	prices.find((price) => isSupportedFixedRecurringPrice(price) && price.unit_amount === 0)?.id ??
	null;

const findProduct = async (stripe: Stripe, configuredProductId: string) => {
	if (configuredProductId) return stripe.products.retrieve(configuredProductId);
	const products = await stripe.products.list({ active: true, limit: 2 });
	return products.data[0] ?? null;
};

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	try {
		const stripe = createStripeClient(platform);
		const product = await findProduct(stripe, getStripePublicConfig(platform).productId);
		if (!product || 'deleted' in product)
			return { productName: 'Maal', pricing: [], trialPriceId: null, trialAvailable: false };

		const prices = await stripe.prices.list({
			product: product.id,
			active: true,
			limit: 20
		});
		const trialPriceId = _trialPriceIdFromPrices(prices.data);
		const trialDefaultOption = trialDefaultPricingOptionFromPrices(prices.data, product.id);
		const pricing = prices.data
			.map(_paidLandingPrice)
			.filter((price): price is LandingPrice => Boolean(price))
			.map((price) => ({
				...price,
				supportsTrial: price.id === trialDefaultOption?.id,
				trialPriceId: price.id === trialDefaultOption?.id ? trialPriceId : null
			}))
			.sort(
				(left, right) => (priceOrder.get(left.label) ?? 99) - (priceOrder.get(right.label) ?? 99)
			);
		let trialAvailable = false;
		if (locals.session && platform?.env.DB && trialPriceId) {
			const { householdId } = await resolveActiveHouseholdId({
				platform,
				cookies,
				url,
				session: locals.session
			});
			if (householdId) {
				trialAvailable = (
					await loadTrialAvailability({
						database: platform.env.DB,
						userId: locals.session.user.id,
						householdId
					})
				).available;
			}
		}

		return { productName: product.name, pricing, trialPriceId, trialAvailable };
	} catch {
		return { productName: 'Maal', pricing: [], trialPriceId: null, trialAvailable: false };
	}
};
