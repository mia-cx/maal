import { error, redirect } from '@sveltejs/kit';

import { isInviteCode, normalizeInviteCode } from '$lib/domain/household/invites.js';
import type { RequestHandler } from './$types';

/**
 * Shareable invite link. The Worker never looks the code up or stores it: it only hands the code to
 * the local-first household page, which joins as the active profile or asks to sign one in first.
 */
export const GET: RequestHandler = ({ params }) => {
	if (!isInviteCode(params.code)) error(404, 'Invite not found.');
	redirect(303, `/household?join=${normalizeInviteCode(params.code)}`);
};
