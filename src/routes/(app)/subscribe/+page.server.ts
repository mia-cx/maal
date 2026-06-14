import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { createStripeClient, getStripeProductId } from '$lib/server/domains/billing';
import { loadBillingStatus } from '$lib/server/domains/billing';
import { loadTrialAvailability } from '$lib/server/domains/billing';
import { pricingOptionsFromPrices, type PricingOption } from '$lib/server/billing/pricing-options';

export type { PricingOption };

export const load: PageServerLoad = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(302, `/auth/login?returnTo=${encodeURIComponent('/subscribe')}`);
	if (!platform?.env.DB) error(503, { message: 'Billing storage is not available.' });

	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) redirect(302, '/onboarding');

	const billing = await loadBillingStatus(platform.env.DB, householdId);
	if (billing.isPaid) redirect(302, '/plan');
	if (!(await canManageActiveHousehold(platform, session, householdId))) redirect(302, '/plan');

	const accessibleHouseholds = await listUserHouseholds(platform, session.user.id).catch(() => []);
	const householdName =
		accessibleHouseholds.find((household) => household.id === householdId)?.name ??
		'Current household';

	const stripe = createStripeClient(platform);
	const productId = getStripeProductId(platform);
	const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
	const options = pricingOptionsFromPrices(prices.data);

	const trialAvailability = await loadTrialAvailability({
		database: platform.env.DB,
		userId: session.user.id,
		householdId
	});

	return {
		billing,
		householdName,
		trialAvailable: trialAvailability.available,
		paidOptions: options.filter((option) => option.amount > 0),
		trialOption: options.find((option) => option.amount === 0) ?? null
	};
};
