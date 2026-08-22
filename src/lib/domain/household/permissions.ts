import { Data } from 'effect';

import type { HouseholdPermission, Membership } from './contracts.js';

export class CachedPermissionDenied extends Data.TaggedError('CachedPermissionDenied')<{
	readonly householdId: string;
	readonly permission: HouseholdPermission;
	readonly reason: 'membershipMissing' | 'membershipInactive' | 'permissionMissing';
}> {}

export const hasCachedPermission = (
	membership: Membership | undefined,
	permission: HouseholdPermission
): boolean => membership?.status === 'active' && membership.permissions.includes(permission);

export const requireCachedPermission = (
	membership: Membership | undefined,
	householdId: string,
	permission: HouseholdPermission
): Membership => {
	if (!membership) {
		throw new CachedPermissionDenied({ householdId, permission, reason: 'membershipMissing' });
	}
	if (membership.status !== 'active') {
		throw new CachedPermissionDenied({ householdId, permission, reason: 'membershipInactive' });
	}
	if (!membership.permissions.includes(permission)) {
		throw new CachedPermissionDenied({ householdId, permission, reason: 'permissionMissing' });
	}
	return membership;
};
