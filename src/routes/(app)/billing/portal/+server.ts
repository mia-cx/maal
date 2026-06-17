import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createBillingPortalSession } from '$lib/server/billing/portal';
import { readJsonObject } from '$lib/server/http/request';

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: m.app_sign_in_required() });

	const body = await readJsonObject(request);
	const requestedHouseholdId =
		typeof body.householdId === 'string' && body.householdId.trim()
			? body.householdId.trim()
			: null;
	return json(
		await createBillingPortalSession({
			cookies,
			platform,
			requestedHouseholdId,
			session,
			url
		})
	);
};
