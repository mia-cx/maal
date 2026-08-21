import { json } from '@sveltejs/kit';
import {
	authCookieOptions,
	authIdentityCookieName,
	authSlotAdapterFor,
	authSlotCookieName,
	authStatusForReason,
	revokeSelectedSession,
	routeSlotId,
	taggedErrorResponse
} from '$lib/server/auth-slots';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const slotId = routeSlotId(event);
		const sealedSession = event.cookies.get(authSlotCookieName(slotId));
		if (!sealedSession) return json({ authSlotId: slotId, status: 'reauthRequired' });

		const result = await authSlotAdapterFor(event.platform?.env).authenticate(sealedSession);
		if (!result.authenticated) {
			return json({ authSlotId: slotId, status: authStatusForReason(result.reason) });
		}

		return json({
			authSlotId: slotId,
			status: 'authenticated',
			workosUserId: result.user.id,
			user: result.user,
			organizationId: result.organizationId,
			verifiedAt: new Date().toISOString()
		});
	} catch (cause) {
		return taggedErrorResponse(cause);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const slotId = routeSlotId(event);
		await revokeSelectedSession(event, slotId);
		event.cookies.delete(authIdentityCookieName(slotId), authCookieOptions(slotId));
		return new Response(null, { status: 204 });
	} catch (cause) {
		return taggedErrorResponse(cause);
	}
};
