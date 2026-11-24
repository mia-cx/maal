import { redirect } from '@sveltejs/kit';
import { createAuthSlotId } from '$lib/auth-slots/contracts.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const requested = url.searchParams.get('returnTo');
	const returnTo = requested === '/subscribe' || requested === '/onboarding' ? requested : '/plan';
	redirect(
		303,
		`/api/auth-slots/${createAuthSlotId()}/authorize?returnTo=${encodeURIComponent(returnTo)}`
	);
};
