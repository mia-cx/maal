import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSealedSession, getLogoutUrl } from '$lib/server/auth/session';
import { tryCreateAuthRuntime } from '$lib/server/auth/workos';

export const GET: RequestHandler = async ({ cookies, platform, url }) => {
	const runtime = tryCreateAuthRuntime(platform);
	const workosLogoutUrl = runtime
		? await getLogoutUrl({ runtime, cookies, returnTo: url.origin })
		: null;

	clearSealedSession(cookies);
	redirect(303, workosLogoutUrl ?? '/');
};
