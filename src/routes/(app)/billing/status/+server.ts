import { json, error, type RequestHandler } from '@sveltejs/kit';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { getStripePublicConfig } from '$lib/server/billing/stripe';
import { loadBillingStatus } from '$lib/server/billing/subscriptions';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(404, { message: 'No household found.' });

	const config = getStripePublicConfig(platform);
	const accessibleHouseholds = await listUserHouseholds(platform, session.user.id).catch(() => []);
	const activeHouseholdName =
		accessibleHouseholds.find((household) => household.id === householdId)?.name ??
		'Current household';
	const billing = platform?.env.DB
		? await loadBillingStatus(platform.env.DB, householdId)
		: {
				householdId,
				stripeCustomerId: null,
				subscriberUserId: null,
				stripeSubscriptionId: null,
				stripePriceId: null,
				status: null,
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				isPaid: false
			};
	const householdBilling = platform?.env.DB
		? (
				await Promise.all(
					accessibleHouseholds.map(async (household) => {
						const [status, canManageBilling] = await Promise.all([
							loadBillingStatus(platform.env.DB, household.id),
							canManageActiveHousehold(platform, session, household.id)
						]);
						return {
							...status,
							householdName: household.name,
							isActiveHousehold: household.id === householdId,
							canManageBilling
						};
					})
				)
			).filter((household) => household.canManageBilling)
		: [];

	return json({
		...billing,
		householdName: activeHouseholdName,
		canManageBilling: householdBilling.some((household) => household.householdId === householdId),
		householdBilling,
		publishableKey: config.publishableKey,
		pricingTableId: config.pricingTableId,
		customerEmail: session.user.email
	});
};
