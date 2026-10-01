import type { MaalDatabase } from '$lib/client/local/database.js';
import type { HouseholdPermission } from '$lib/domain/household/contracts.js';

import { localCapabilityAllowsSync } from './capability.js';

export interface LocalHouseholdSyncCapability {
	readonly enabled: boolean;
	readonly stale: boolean;
	readonly membershipActive: boolean;
	readonly permissions: readonly HouseholdPermission[];
}

export const resolveLocalHouseholdSyncCapability = async (
	database: MaalDatabase,
	workosUserId: string,
	householdId: string,
	now = new Date()
): Promise<LocalHouseholdSyncCapability> => {
	const membership = await database.memberships
		.where('[householdId+workosUserId]')
		.equals([householdId, workosUserId])
		.first();
	if (
		!membership ||
		membership.status !== 'active' ||
		!membership.permissions.includes('meals:read')
	) {
		return { enabled: false, stale: false, membershipActive: false, permissions: [] };
	}
	const capability = await database.billingCapabilities.get(householdId);
	if (!capability || !localCapabilityAllowsSync(capability, now)) {
		return {
			enabled: false,
			stale: capability?.stale ?? false,
			membershipActive: true,
			permissions: membership.permissions
		};
	}
	return {
		enabled: true,
		stale: capability.stale,
		membershipActive: true,
		permissions: membership.permissions
	};
};
