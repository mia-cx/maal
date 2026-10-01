import type { MaalDatabase } from '$lib/client/local/database.js';
import { billingCapabilityIsEnabledAt } from '$lib/domain/billing/capability.js';
import type { BillingCapability } from '$lib/domain/billing/contracts.js';

export interface LocalUserSyncCapability {
	readonly enabled: boolean;
	readonly stale: boolean;
	readonly householdId: string | null;
}

/**
 * Local gate for remote sync. A renewing plan stays open past its cached period end, because
 * Stripe renews it without telling this tab; the Worker checks every request and a denial marks
 * the cache stale. Grace windows and plans cancelling at period end close at `validUntil`.
 */
export const localCapabilityAllowsSync = (capability: BillingCapability, now: Date): boolean =>
	(capability.state === 'enabled' && !capability.cancelAtPeriodEnd) ||
	billingCapabilityIsEnabledAt(capability, now.getTime());

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
		if (!capability || !localCapabilityAllowsSync(capability, now)) continue;
		return {
			enabled: true,
			stale: capability.stale,
			householdId: membership.householdId
		};
	}

	return { enabled: false, stale: false, householdId: null };
};
