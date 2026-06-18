import * as m from '$lib/paraglide/messages';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import {
	createStripeClient,
	getStripeProductId,
	listActiveProductPrices,
	loadFreshBillingStatus,
	loadTrialAvailability,
	pricingOptionsFromPrices,
	trialDefaultPricingOptionFromPrices,
	type PricingOption
} from '$lib/server/domains/billing';

export type { PricingOption };

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(302, `/auth/login?returnTo=${encodeURIComponent('/subscribe')}`);
	if (!platform?.env.DB) error(503, { message: m.billing_billing_storage_is_not_available() });

	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) redirect(302, '/onboarding');

	const billing = await loadFreshBillingStatus(platform, householdId);
	if (billing.isPaid) redirect(302, '/plan');
	if (!(await canManageActiveHousehold(platform, session, householdId))) redirect(302, '/plan');

	let accessibleHouseholds;
	try {
		accessibleHouseholds = await listUserHouseholds(platform, session.user.id);
	} catch (cause) {
		console.error('Failed to load households for subscribe page', cause);
		error(503, { message: m.billing_could_not_load_your_households_try_again_in_() });
	}
	const householdName =
		accessibleHouseholds.find((household) => household.id === householdId)?.name ??
		m.billing_current_household();

	const stripe = createStripeClient(platform);
	const productId = getStripeProductId(platform);
	const prices = await listActiveProductPrices(stripe, productId);
	const options = pricingOptionsFromPrices(prices);
	const trialOption = options.find((option) => option.amount === 0) ?? null;
	const trialDefaultOption = trialDefaultPricingOptionFromPrices(prices, productId);

	const trialAvailability = await loadTrialAvailability({
		database: platform.env.DB,
		userId: session.user.id,
		householdId
	});

	return {
		billing,
		householdName,
		trialAvailable: trialAvailability.available,
		paidOptions: options
			.filter((option) => option.amount > 0)
			.map((option) => ({
				...option,
				supportsTrial: option.id === trialDefaultOption?.id,
				trialPriceId: option.id === trialDefaultOption?.id ? trialOption?.id : null
			})),
		trialOption
	};
};
