import { ServerSyncCapabilityDenied, ServerSyncPermissionDenied } from './errors.js';

export type UserSyncPermission = 'recipes:read' | 'recipes:write';

export interface UserSyncCapabilityInput {
	readonly database: D1Database;
	readonly workosUserId: string;
	readonly activeWorkOSOrganizationIds: readonly string[];
	readonly permission: UserSyncPermission;
	readonly now: string;
}

export interface UserSyncCapabilityGrant {
	readonly householdId: string;
	readonly permission: UserSyncPermission;
}

export interface UserSyncCapabilityAuthorizer {
	authorize(input: UserSyncCapabilityInput): Promise<UserSyncCapabilityGrant>;
}

interface CapabilityRow {
	household_id: string;
	permissions: string;
	status: string;
	grace_until: string | null;
}

const permissionsFor = (encoded: string): readonly string[] => {
	try {
		const decoded: unknown = JSON.parse(encoded);
		return Array.isArray(decoded)
			? decoded.filter((permission): permission is string => typeof permission === 'string')
			: [];
	} catch {
		return [];
	}
};

export const d1UserSyncCapabilityAuthorizer: UserSyncCapabilityAuthorizer = {
	async authorize(input) {
		if (input.activeWorkOSOrganizationIds.length === 0) {
			throw new ServerSyncCapabilityDenied({
				code: 'no_active_household',
				message: 'No current WorkOS household membership enables synchronization.'
			});
		}
		const placeholders = input.activeWorkOSOrganizationIds.map(() => '?').join(', ');
		const statement = input.database
			.prepare(
				`SELECT hm.household_id, hm.permissions, bs.status, bs.grace_until
				 FROM household_memberships hm
				 JOIN billing_subscriptions bs ON bs.household_id = hm.household_id
				 WHERE hm.workos_user_id = ?
				   AND hm.status = 'active'
				   AND hm.household_id IN (${placeholders})
				   AND (
				     bs.status IN ('active', 'trialing')
				     OR (bs.status IN ('past_due', 'paused') AND bs.grace_until IS NOT NULL AND bs.grace_until >= ?)
				   )`
			)
			.bind(input.workosUserId, ...input.activeWorkOSOrganizationIds, input.now);
		const result = await statement.all<CapabilityRow>();
		if (result.results.length === 0) {
			throw new ServerSyncCapabilityDenied({
				code: 'maal_plan_required',
				message: 'An active or grace Maal plan is required.'
			});
		}
		const permitted = result.results.find((row) =>
			permissionsFor(row.permissions).includes(input.permission)
		);
		if (!permitted) {
			throw new ServerSyncPermissionDenied({
				code: 'recipes_permission_required',
				message: 'A current household membership does not grant the required recipe permission.'
			});
		}
		return { householdId: permitted.household_id, permission: input.permission };
	}
};
