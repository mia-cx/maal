import type { MaalDatabase } from '$lib/client/local/database.js';

export interface LocalUserSyncCapability {
	readonly enabled: boolean;
	readonly stale: boolean;
	readonly householdId: string | null;
}

export const resolveLocalUserSyncCapability = async (
	database: MaalDatabase,
	workosUserId: string,
	now = new Date()
): Promise<LocalUserSyncCapability> => {
	const memberships = await database.memberships
		.where('[workosUserId+status]')
		.equals([workosUserId, 'active'])
		.toArray();

	for (const membership of memberships) {
		if (!membership.permissions.includes('recipes:read')) continue;
		const capability = await database.billingCapabilities.get(membership.householdId);
		if (!capability || capability.state === 'disabled') continue;
		if (
			capability.state === 'grace' &&
			(capability.validUntil === null || Date.parse(capability.validUntil) < now.getTime())
		) {
			continue;
		}
		return {
			enabled: true,
			stale: capability.stale,
			householdId: membership.householdId
		};
	}

	return { enabled: false, stale: false, householdId: null };
};
