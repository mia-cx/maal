import { error, redirect } from '@sveltejs/kit';
import { createAuthSlotId } from '$lib/auth-slots';
import {
	authFlowCookieName,
	authFlowCookieOptions,
	authIdentityCookieName,
	authSlotAdapterFor,
	callbackPath,
	encodeAuthFlow,
	expectedUserForFlow,
	openSlotIdentity,
	readAuthSlotConfig,
	routeSlotId,
	safeReturnTo,
	taggedErrorResponse,
	type AuthFlowPurpose
} from '$lib/server/auth-slots';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const slotId = routeSlotId(event);
		const purpose = parsePurpose(event.url.searchParams.get('purpose'));
		const config = readAuthSlotConfig(event.platform?.env);
		const adapter = authSlotAdapterFor(event.platform?.env);
		const boundUserId = await openSlotIdentity(
			event.cookies.get(authIdentityCookieName(slotId)),
			config.cookiePassword
		);
		const expectedUserId = expectedUserForFlow(purpose, boundUserId);

		const state = createAuthSlotId();
		const returnTo = safeReturnTo(event.url.searchParams.get('returnTo'));
		event.cookies.set(
			authFlowCookieName(slotId),
			encodeAuthFlow({
				state,
				purpose,
				expectedUserId,
				returnTo,
				createdAt: new Date().toISOString()
			}),
			authFlowCookieOptions(slotId)
		);

		const authorizationUrl = adapter.authorizationUrl({
			redirectUri: callbackPath(event.url.origin, slotId),
			state,
			...(event.url.searchParams.get('loginHint')
				? { loginHint: event.url.searchParams.get('loginHint')! }
				: {})
		});
		redirect(303, authorizationUrl);
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		return taggedErrorResponse(cause);
	}
};

function parsePurpose(value: string | null): AuthFlowPurpose {
	if (value === null || value === 'add-profile') return 'add-profile';
	if (value === 'reauthenticate') return value;
	error(400, 'Unknown authentication purpose');
}
