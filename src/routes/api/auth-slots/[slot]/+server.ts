import { json } from '@sveltejs/kit';
import type { AuthSlotMetadata } from '$lib/auth-slots';
import {
	authCompletionCookieName,
	authCookieOptions,
	authIdentityCookieName,
	authSlotAdapterFor,
	authSlotCookieName,
	authStatusForReason,
	discoverActiveHouseholds,
	openAuthCompletion,
	readAuthSlotConfig,
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

		const adapter = authSlotAdapterFor(event.platform?.env);
		const result = await adapter.authenticate(sealedSession);
		if (!result.authenticated) {
			return metadataResponse({
				schemaVersion: 1,
				authSlotId: slotId,
				status: authStatusForReason(result.reason)
			});
		}

		const completionCookie = event.cookies.get(authCompletionCookieName(slotId));
		let proof = null;
		if (completionCookie !== undefined) {
			event.cookies.delete(authCompletionCookieName(slotId), authCookieOptions(slotId));
			const flow = await openAuthCompletion(
				completionCookie,
				readAuthSlotConfig(event.platform?.env).cookiePassword
			);
			if (flow?.authSlotId === slotId && flow.expectedUserId === result.user.id) {
				proof = flow;
			}
		}

		const database = event.platform?.env.DB;
		if (!database) throw new TypeError('D1 is unavailable.');
		const now = new Date().toISOString() as `${string}Z`;
		const households = await discoverActiveHouseholds({
			database,
			workosUserId: result.user.id,
			liveMemberships: await adapter.listActiveMemberships(result.user.id),
			now
		});

		return metadataResponse({
			schemaVersion: 1,
			authSlotId: slotId,
			status: 'authenticated',
			workosUserId: result.user.id,
			email: result.user.email,
			firstName: result.user.firstName,
			lastName: result.user.lastName,
			profilePictureUrl: result.user.profilePictureUrl,
			verifiedAt: now,
			households,
			...(proof
				? {
						freshAuthentication: true,
						...(proof.pinResetNonce === undefined ? {} : { pinResetNonce: proof.pinResetNonce })
					}
				: {})
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
		event.cookies.delete(authCompletionCookieName(slotId), authCookieOptions(slotId));
		await revokeSelectedSession(event, slotId);
		if (event.url.searchParams.get('preserveIdentity') !== 'true') {
			event.cookies.delete(authIdentityCookieName(slotId), authCookieOptions(slotId));
		}
		return new Response(null, { status: 204 });
	} catch (cause) {
		return taggedErrorResponse(cause);
	}
};
