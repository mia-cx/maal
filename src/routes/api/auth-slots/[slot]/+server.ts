import { json } from '@sveltejs/kit';
import type { AuthSlotMetadata } from '$lib/auth-slots';
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

// The retained cookie is scoped to this exact slash-terminated path.
export const trailingSlash = 'always';

export const GET: RequestHandler = async (event) => {
	try {
		const slotId = routeSlotId(event);
		const sealedSession = event.cookies.get(authSlotCookieName(slotId));
		if (!sealedSession) {
			return metadataResponse({ schemaVersion: 1, authSlotId: slotId, status: 'reauthRequired' });
		}

		const result = await authSlotAdapterFor(event.platform?.env).authenticate(sealedSession);
		if (!result.authenticated) {
			return metadataResponse({
				schemaVersion: 1,
				authSlotId: slotId,
				status: authStatusForReason(result.reason)
			});
		}

		return metadataResponse({
			schemaVersion: 1,
			authSlotId: slotId,
			status: 'authenticated',
			workosUserId: result.user.id,
			email: result.user.email,
			firstName: result.user.firstName,
			lastName: result.user.lastName,
			profilePictureUrl: result.user.profilePictureUrl,
			verifiedAt: new Date().toISOString() as `${string}Z`
		});
	} catch (cause) {
		return taggedErrorResponse(cause);
	}
};

const metadataResponse = (metadata: AuthSlotMetadata): Response =>
	json(metadata, { headers: { 'cache-control': 'private, no-store' } });

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
