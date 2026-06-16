import { error, type Cookies } from '@sveltejs/kit';
import type { AuthSession } from '$lib/server/auth/session';
import {
	canManageActiveHousehold,
	listUserHouseholdIds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { createStripeClient } from './stripe';
import { loadBillingStatus } from './subscriptions';

export const createBillingPortalSession = async ({
	cookies,
	platform,
	requestedHouseholdId,
	session,
	url
}: {
	cookies: Cookies;
	platform: App.Platform | undefined;
	requestedHouseholdId?: string | null;
	session: AuthSession;
	url: URL;
}): Promise<{ url: string }> => {
	if (!platform?.env.DB) error(503, { message: 'Billing storage is not available.' });
	const { householdId: activeHouseholdId } = await resolveActiveHouseholdId({
		platform,
		cookies,
		url,
		session
	});
	const householdId = requestedHouseholdId ?? activeHouseholdId;
	if (!householdId) error(404, { message: 'No household found.' });
	const householdIds = await listUserHouseholdIds(platform, session.user.id);
	if (!householdIds.includes(householdId)) error(403, { message: 'Household not available.' });

	const billing = await loadBillingStatus(platform.env.DB, householdId);
	if (!billing.stripeCustomerId) error(400, { message: 'No Stripe customer found yet.' });
	if (!(await canManageActiveHousehold(platform, session, householdId))) {
		error(403, { message: 'Only household managers can manage this household subscription.' });
	}

	const stripe = createStripeClient(platform);
	const portal = await stripe.billingPortal.sessions.create({
		customer: billing.stripeCustomerId,
		return_url: `${url.origin}/plan?settings=billing`
	});
	return { url: portal.url };
};
