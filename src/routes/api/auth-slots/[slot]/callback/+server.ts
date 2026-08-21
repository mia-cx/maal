import { error, redirect } from '@sveltejs/kit';
import { assertReauthenticatedUser } from '$lib/auth-slots';
import {
	assertAuthSlotCookieFits,
	authCookieOptions,
	authFlowCookieName,
	authFlowCookieOptions,
	authIdentityCookieName,
	authSlotAdapterFor,
	authSlotCookieName,
	clientAddress,
	decodeAuthFlow,
	readAuthSlotConfig,
	routeSlotId,
	sealSlotIdentity,
	taggedErrorResponse
} from '$lib/server/auth-slots';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const slotId = routeSlotId(event);
	const flowCookieName = authFlowCookieName(slotId);
	const flow = decodeAuthFlow(event.cookies.get(flowCookieName));
	const state = event.url.searchParams.get('state');
	const code = event.url.searchParams.get('code');

	if (!flow || !state || state !== flow.state || !code) {
		error(400, 'The authentication flow is invalid or expired');
	}

	try {
		const config = readAuthSlotConfig(event.platform?.env);
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

		assertAuthSlotCookieFits(slotId, session.sealedSession);
		event.cookies.set(authSlotCookieName(slotId), session.sealedSession, authCookieOptions(slotId));
		event.cookies.set(
			authIdentityCookieName(slotId),
			await sealSlotIdentity(session.user.id, config.cookiePassword),
			authCookieOptions(slotId)
		);
		event.cookies.delete(flowCookieName, authFlowCookieOptions(slotId));

		const destination = new URL(flow.returnTo, event.url.origin);
		destination.searchParams.set('authSlot', slotId);
		destination.searchParams.set('authStatus', 'authenticated');
		redirect(303, `${destination.pathname}${destination.search}${destination.hash}`);
	} catch (cause) {
		event.cookies.delete(flowCookieName, authFlowCookieOptions(slotId));
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		return taggedErrorResponse(cause);
	}
};
