import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createBillingPortalSession } from '$lib/server/billing/portal';

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

	const body = await readJson(request);
	const requestedHouseholdId =
		typeof body === 'object' &&
		body &&
		'householdId' in body &&
		typeof body.householdId === 'string'
			? body.householdId
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
