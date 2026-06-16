import { error, json, type RequestHandler } from '@sveltejs/kit';
import { loadBillingStatusView } from '$lib/server/billing/status-view';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	return json(await loadBillingStatusView({ cookies, platform, session, url }));
};
