import { listMaalPrices } from '$lib/server/billing/pricing.js';
import {
	BillingConfigurationError,
	createStripeClient,
	stripeProductId
} from '$lib/server/billing/stripe.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const environment = platform?.env;
	try {
		const prices = await listMaalPrices(
			createStripeClient(environment),
			stripeProductId(environment)
		);
		return { pricing: prices, pricingStatus: prices.length ? 'available' : 'empty' };
	} catch (cause) {
		if (!(cause instanceof BillingConfigurationError))
			console.error('Failed to load landing pricing', cause);
		return { pricing: [], pricingStatus: 'unavailable' };
	}
};
