import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { provisionAuthSession } from '$lib/server/auth/provisioning';
import {
	clearOAuthReturnTo,
	clearOAuthState,
	commitSealedSession,
	getRequestMetadata,
	readOAuthReturnTo,
	readOAuthState
} from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';

export const GET: RequestHandler = async ({ cookies, platform, request, url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expectedState = readOAuthState(cookies);
	const returnTo = readOAuthReturnTo(cookies) ?? '/';
	clearOAuthState(cookies);
	clearOAuthReturnTo(cookies);

	if (!code) error(400, 'Missing WorkOS authorization code');
	if (!state || !expectedState || state !== expectedState) error(400, 'Invalid WorkOS OAuth state');

	const runtime = createAuthRuntime(platform);
	const { ipAddress, userAgent } = getRequestMetadata(request);
	const auth = await runtime.workos.userManagement.authenticateWithCode({
		code,
		clientId: runtime.clientId,
		...(ipAddress ? { ipAddress } : {}),
		...(userAgent ? { userAgent } : {}),
		session: {
			sealSession: true,
			cookiePassword: runtime.cookiePassword
		}
	});

	if (!auth.sealedSession) error(500, 'WorkOS did not return a sealed session');

	await provisionAuthSession(platform, {
		user: auth.user,
		organizationId: auth.organizationId ?? null
	});
	commitSealedSession(cookies, auth.sealedSession, url);

	redirect(303, returnTo);
};
