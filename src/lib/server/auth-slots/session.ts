import type { RequestEvent } from '@sveltejs/kit';
import type { AuthSlotId } from '$lib/auth-slots';
import { authSlotAdapterFor } from './config';
import { authCookieOptions, authSlotCookieName } from './cookies';

export async function revokeSelectedSession(
	event: Pick<RequestEvent, 'cookies' | 'platform'>,
	slotId: AuthSlotId
) {
	const cookieName = authSlotCookieName(slotId);
	const sealedSession = event.cookies.get(cookieName);
	if (!sealedSession) return;

	const adapter = authSlotAdapterFor(event.platform?.env);
	let result = await adapter.authenticate(sealedSession);
	if (!result.authenticated) {
		const refreshed = await adapter.refresh(sealedSession);
		if (!refreshed.authenticated) {
			event.cookies.delete(cookieName, authCookieOptions(slotId));
			return;
		}
		result = refreshed;
	}

	await adapter.revoke(result.sessionId);
	event.cookies.delete(cookieName, authCookieOptions(slotId));
}
