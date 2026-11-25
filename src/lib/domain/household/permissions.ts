import { Data } from 'effect';

import {
	householdPermissionValues,
	type HouseholdPermission,
	type Membership
} from './contracts.js';

/**
 * Migration only: permission strings that prototype WorkOS roles may still carry. Delete these
 * entries once no staging or production role definition uses them.
 */
const legacyPermissionGrants: ReadonlyArray<readonly [string, readonly HouseholdPermission[]]> = [
	['household:manage', householdPermissionValues],
	['household:meals:attend', ['meals:read']],
	['household:meals:manage', ['recipes:read', 'recipes:write', 'meals:read', 'meals:write']]
];

const permissionGrants = new Map<string, readonly HouseholdPermission[]>([
	...householdPermissionValues.map((permission) => [permission, [permission]] as const),
	// As in the prototype, managing the household implies every other permission.
	['households:write', householdPermissionValues],
	...legacyPermissionGrants
]);

/**
 * Expands the permission strings on WorkOS roles into the household permissions Maal checks.
 * Every WorkOS ingestion point runs this before storing or checking permissions. Strings without a
 * grant drop, including WorkOS-only ones like `check_ins:*` and `food_profile:*` that MCP key scopes
 * cover instead. The result follows `householdPermissionValues` order and is idempotent.
 */
export const expandWorkOSPermissions = (
	workosPermissions: readonly string[]
): HouseholdPermission[] => {
	const granted = new Set(
		workosPermissions.flatMap((permission) => permissionGrants.get(permission) ?? [])
	);
	return householdPermissionValues.filter((permission) => granted.has(permission));
};

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
