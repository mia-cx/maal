import { error, redirect } from '@sveltejs/kit';
import { assertReauthenticatedUser } from '$lib/auth-slots';
import {
	assertAuthSlotCookieFits,
	authCookieOptions,
	authFlowCookieName,
	authFlowCookieOptions,
	AUTH_FLOW_MARKER_VALUE,
	authIdentityCookieName,
	authSlotAdapterFor,
	authSlotCookieName,
	clientAddress,
	openAuthFlow,
	readAuthSlotConfig,
	sealSlotIdentity,
	taggedErrorResponse
} from '$lib/server/auth-slots';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const state = event.url.searchParams.get('state');
		const code = event.url.searchParams.get('code');
		const config = readAuthSlotConfig(event.platform?.env);
		const flow = await openAuthFlow(state, config.cookiePassword);

		if (!flow || !code) error(400, 'The authentication flow is invalid or expired');

		const markerName = authFlowCookieName(flow.nonce);
		if (event.cookies.get(markerName) !== AUTH_FLOW_MARKER_VALUE) {
			error(400, 'The authentication flow is invalid or expired');
		}
		event.cookies.delete(markerName, authFlowCookieOptions());

		const adapter = authSlotAdapterFor(event.platform?.env);
		const session = await adapter.exchangeCode({
			code,
			ipAddress: clientAddress(event),
			userAgent: event.request.headers.get('user-agent') ?? undefined
		});

		if (flow.expectedUserId) {
			try {
				assertReauthenticatedUser(flow.expectedUserId, session.user.id);
			} catch (cause) {
				await adapter.revoke(session.sessionId);
				throw cause;
			}
		}

		const slotId = flow.authSlotId;
		assertAuthSlotCookieFits(slotId, session.sealedSession);
		event.cookies.set(authSlotCookieName(slotId), session.sealedSession, authCookieOptions(slotId));
		event.cookies.set(
			authIdentityCookieName(slotId),
			await sealSlotIdentity(session.user.id, config.cookiePassword),
			authCookieOptions(slotId)
		);

		const destination = new URL(flow.returnTo, event.url.origin);
		destination.searchParams.set('authSlot', slotId);
		destination.searchParams.set('authStatus', 'authenticated');
		redirect(303, `${destination.pathname}${destination.search}${destination.hash}`);
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		return taggedErrorResponse(cause);
	}
};
