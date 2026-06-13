import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import {
	joinHouseholdFromInvite,
	loadHouseholdInviteByCode
} from '$lib/server/auth/household-invites';

export const GET: RequestHandler = async ({ cookies, locals, platform, url, params }) => {
	const code = params.code?.trim() ?? '';
	if (!code) error(404, { message: 'Invite not found.' });
	if (!platform?.env.DB) error(503, { message: 'Invite storage is not available.' });

	const invite = await loadHouseholdInviteByCode(platform.env.DB, code);
	if (!invite) error(404, { message: 'Invite not found.' });

	if (!locals.session) {
		redirect(
			303,
			resolve(
				`/auth/login?screen_hint=sign-up&returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`
			)
		);
	}

	try {
		await joinHouseholdFromInvite({
			platform,
			cookies,
			url,
			code,
			userId: locals.session.user.id
		});
	} catch (cause) {
		console.error('Failed to join household from invite', cause);
		error(502, { message: 'Could not join household.' });
	}

	redirect(303, '/plan?joined=1');
};
