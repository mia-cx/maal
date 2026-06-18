import * as m from '$lib/paraglide/messages';
import { error, type Cookies } from '@sveltejs/kit';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import type { AuthSession } from '$lib/server/auth/session';
import { getStripePublicConfig } from './stripe';
import { loadFreshBillingStatus } from './subscriptions';

export const loadBillingStatusView = async ({
	cookies,
	platform,
	session,
	url
}: {
	cookies: Cookies;
	platform: App.Platform | undefined;
	session: AuthSession;
	url: URL;
}) => {
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(404, { message: m.household_no_household_found() });

	const config = getStripePublicConfig(platform);
	let householdListDegraded = false;
	const accessibleHouseholds = await listUserHouseholds(platform, session.user.id).catch(
		(cause) => {
			console.error('Failed to list households for billing status view', cause);
			householdListDegraded = true;
			return [];
		}
	);
	const activeHouseholdName =
		accessibleHouseholds.find((household) => household.id === householdId)?.name ??
		m.billing_current_household();
	const billing = platform?.env.DB
		? await loadFreshBillingStatus(platform, householdId)
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
							loadFreshBillingStatus(platform, household.id),
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

	return {
		...billing,
		householdName: activeHouseholdName,
		canManageBilling: householdBilling.some((household) => household.householdId === householdId),
		householdBilling,
		publishableKey: config.publishableKey,
		pricingTableId: config.pricingTableId,
		customerEmail: session.user.email,
		householdListDegraded
	};
};
