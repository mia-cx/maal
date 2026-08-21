import type { RequestEvent } from '@sveltejs/kit';

import {
	authSlotAdapterFor,
	authSlotCookieName,
	routeSlotId
} from '$lib/server/auth-slots/index.js';

import { ServerSyncUnauthenticated } from './errors.js';

export interface AuthenticatedSyncSlot {
	readonly authSlotId: string;
	readonly workosUserId: string;
	readonly activeOrganizationIds: readonly string[];
}

export const authenticateSyncSlot = async (
	event: Pick<RequestEvent, 'cookies' | 'params' | 'platform'>
): Promise<AuthenticatedSyncSlot> => {
	const authSlotId = routeSlotId(event);
	const sealedSession = event.cookies.get(authSlotCookieName(authSlotId));
	if (!sealedSession) {
		throw new ServerSyncUnauthenticated({
			code: 'auth_slot_missing',
			message: 'The selected auth slot has no session.'
		});
	}
	const adapter = authSlotAdapterFor(event.platform?.env);
	const authentication = await adapter.authenticate(sealedSession);
	if (!authentication.authenticated) {
		throw new ServerSyncUnauthenticated({
			code: 'auth_slot_expired',
			message: 'The selected auth slot must be reauthenticated.'
		});
	}
	const activeOrganizationIds = await adapter.listActiveOrganizationIds(authentication.user.id);
	return { authSlotId, workosUserId: authentication.user.id, activeOrganizationIds };
};
