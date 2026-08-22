import { error, redirect } from '@sveltejs/kit';
import { createAuthSlotId } from '$lib/auth-slots';
import {
	authFlowCookieName,
	authFlowCookieOptions,
	AUTH_FLOW_LIFETIME_MS,
	AUTH_FLOW_MARKER_VALUE,
	authIdentityCookieName,
	authSlotAdapterFor,
	callbackUrl,
	expectedUserForFlow,
	openSlotIdentity,
	readAuthSlotConfig,
	routeSlotId,
	safeReturnTo,
	sealAuthFlow,
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

		const nonce = createAuthSlotId();
		const issuedAt = new Date();
		const returnTo = safeReturnTo(event.url.searchParams.get('returnTo'));
		const state = await sealAuthFlow(
			{
				schemaVersion: 1,
				authSlotId: slotId,
				purpose,
				expectedUserId,
				returnTo,
				nonce,
				issuedAt: issuedAt.toISOString(),
				expiresAt: new Date(issuedAt.getTime() + AUTH_FLOW_LIFETIME_MS).toISOString()
			},
			config.cookiePassword
		);
		event.cookies.set(authFlowCookieName(nonce), AUTH_FLOW_MARKER_VALUE, authFlowCookieOptions());

		const authorizationUrl = adapter.authorizationUrl({
			redirectUri: callbackUrl(event.url.origin),
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
