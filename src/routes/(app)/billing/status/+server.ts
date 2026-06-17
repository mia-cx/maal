import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { loadBillingStatusView } from '$lib/server/billing/status-view';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: m.app_sign_in_required() });
	return json(await loadBillingStatusView({ cookies, platform, session, url }));
};
