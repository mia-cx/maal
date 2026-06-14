import { error, redirect } from '@sveltejs/kit';
import type Stripe from 'stripe';
import type { PageServerLoad } from './$types';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { createStripeClient, getStripeProductId } from '$lib/server/domains/billing';
import { loadBillingStatus } from '$lib/server/domains/billing';
import { loadTrialAvailability } from '$lib/server/domains/billing';

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
	const options = prices.data
		.filter((price) => price.type === 'recurring' && price.recurring)
		.map((price): PricingOption | null => {
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
		})
		.filter((option): option is PricingOption => Boolean(option))
		.sort(
			(left, right) => (optionOrder.get(left.label) ?? 99) - (optionOrder.get(right.label) ?? 99)
		);

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
