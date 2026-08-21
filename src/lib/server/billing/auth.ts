import type { RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';

import type { HouseholdPermission } from '$lib/domain/household/contracts.js';
import {
	authSlotAdapterFor,
	authSlotCookieName,
	routeSlotId
} from '$lib/server/auth-slots/index.js';
import { getDb } from '$lib/server/db/index.js';
import { householdMemberships } from '$lib/server/db/schema/index.js';

export interface BillingActor {
	readonly authSlotId: string;
	readonly workosUserId: string;
	readonly email: string;
	readonly organizationId: string | null;
}

export const requireBillingActor = async (
	event: RequestEvent,
	householdId: string,
	permission: HouseholdPermission | null = 'households:write'
): Promise<BillingActor> => {
	const database = event.platform?.env.DB;
	if (!database) throw new BillingAuthorizationError('storage_unavailable');
	const authSlotId = routeSlotId(event);
	const sealedSession = event.cookies.get(authSlotCookieName(authSlotId));
	if (!sealedSession) throw new BillingAuthorizationError('reauth_required');
	const authentication = await authSlotAdapterFor(event.platform?.env).authenticate(sealedSession);
	if (!authentication.authenticated) throw new BillingAuthorizationError('reauth_required');

	const membership = (
		await getDb(database)
			.select({
				status: householdMemberships.status,
				permissions: householdMemberships.permissions
			})
			.from(householdMemberships)
			.where(
				and(
					eq(householdMemberships.householdId, householdId),
					eq(householdMemberships.workosUserId, authentication.user.id)
				)
			)
			.limit(1)
	)[0];
	if (membership?.status !== 'active') throw new BillingAuthorizationError('membership_inactive');
	let permissions: unknown;
	try {
		permissions = JSON.parse(membership.permissions);
	} catch {
		throw new BillingAuthorizationError('membership_projection_invalid');
	}
	if (!Array.isArray(permissions) || (permission !== null && !permissions.includes(permission))) {
		throw new BillingAuthorizationError('permission_denied');
	}
	return {
		authSlotId,
		workosUserId: authentication.user.id,
		email: authentication.user.email,
		organizationId: authentication.organizationId
	};
};

export class BillingAuthorizationError extends Error {
	readonly _tag = 'BillingAuthorizationError';
	constructor(
		readonly reason:
			| 'storage_unavailable'
			| 'reauth_required'
			| 'membership_inactive'
			| 'membership_projection_invalid'
			| 'permission_denied'
	) {
		super('This profile cannot manage billing for that household.');
	}
}
