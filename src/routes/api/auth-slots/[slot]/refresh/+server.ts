import { json } from '@sveltejs/kit';
import {
	assertAuthSlotCookieFits,
	authCookieOptions,
	authSlotAdapterFor,
	authSlotCookieName,
	authStatusForReason,
	routeSlotId,
	taggedErrorResponse
} from '$lib/server/auth-slots';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const slotId = routeSlotId(event);
		const cookieName = authSlotCookieName(slotId);
		const sealedSession = event.cookies.get(cookieName);
		if (!sealedSession)
			return json({ authSlotId: slotId, status: 'reauthRequired' }, { status: 401 });

		const body = (await event.request.json().catch(() => ({}))) as { organizationId?: unknown };
		const organizationId =
			typeof body.organizationId === 'string' ? body.organizationId : undefined;
		const result = await authSlotAdapterFor(event.platform?.env).refresh(
			sealedSession,
			organizationId
		);

		if (!result.authenticated) {
			const status = authStatusForReason(result.reason);
			if (status === 'reauthRequired') {
				event.cookies.delete(cookieName, authCookieOptions(slotId));
			}
			return json({ authSlotId: slotId, status }, { status: status === 'stale' ? 503 : 401 });
		}

		assertAuthSlotCookieFits(slotId, result.sealedSession);
		event.cookies.set(cookieName, result.sealedSession, authCookieOptions(slotId));
		return json({
			authSlotId: slotId,
			status: 'authenticated',
			workosUserId: result.user.id,
			organizationId: result.organizationId,
			verifiedAt: new Date().toISOString()
		});
	} catch (cause) {
		return taggedErrorResponse(cause);
	}
};
