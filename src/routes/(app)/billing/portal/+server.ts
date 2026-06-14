import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	canManageActiveHousehold,
	listUserHouseholdIds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { createStripeClient } from '$lib/server/domains/billing';
import { loadBillingStatus } from '$lib/server/domains/billing';

const readJson = async (request: Request): Promise<unknown> => {
	try {
		return await request.json();
	} catch {
		return null;
	}
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Billing storage is not available.' });

	const body = await readJson(request);
	const requestedHouseholdId =
		typeof body === 'object' &&
		body &&
		'householdId' in body &&
		typeof body.householdId === 'string'
			? body.householdId
			: null;
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
	return json({ url: portal.url });
};
