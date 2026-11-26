import { ServerSyncCapabilityDenied, ServerSyncPermissionDenied } from './errors.js';
import type { LiveWorkOSMembership } from '$lib/server/auth-slots/adapter.js';
import { expandWorkOSPermissions } from '$lib/domain/household/permissions.js';
import {
	householdEnablesRemoteService,
	type HouseholdRemoteServiceState
} from '$lib/server/billing/entitlement.js';

export type UserSyncPermission = 'recipes:read' | 'recipes:write';
export type HouseholdSyncPermission = 'meals:read' | 'meals:write' | 'households:write';

export interface UserSyncCapabilityInput {
	readonly database: D1Database;
	readonly workosUserId: string;
	readonly activeWorkOSMemberships: readonly LiveWorkOSMembership[];
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

export interface HouseholdSyncCapabilityInput {
	readonly database: D1Database;
	readonly workosUserId: string;
	readonly householdId: string;
	readonly activeWorkOSMemberships: readonly LiveWorkOSMembership[];
	readonly permission: HouseholdSyncPermission;
	readonly now: string;
}

export interface HouseholdSyncCapabilityGrant {
	readonly householdId: string;
	readonly permission: HouseholdSyncPermission;
}

export interface HouseholdSyncCapabilityAuthorizer {
	authorize(input: HouseholdSyncCapabilityInput): Promise<HouseholdSyncCapabilityGrant>;
}

interface CapabilityRow {
	household_id: string;
	membership_id: string;
	role_slug: string;
	permissions: string;
	/** Stripe status; null when the household has no subscription, as with a WorkOS grant. */
	status: string | null;
	grace_until: string | null;
	current_period_end: string | null;
	deletion_state: string | null;
	stripe_subscription_id: string | null;
	stripe_cancellation_id: string | null;
}

const remoteServiceState = (row: CapabilityRow): HouseholdRemoteServiceState => ({
	status: row.status,
	currentPeriodEnd: row.current_period_end,
	graceUntil: row.grace_until,
	stripeSubscriptionId: row.stripe_subscription_id,
	deletionState: row.deletion_state,
	stripeCancellationId: row.stripe_cancellation_id
});

const permissionsFor = (encoded: string): readonly string[] => {
	try {
		const decoded: unknown = JSON.parse(encoded);
		return Array.isArray(decoded)
			? expandWorkOSPermissions(
					decoded.filter((permission): permission is string => typeof permission === 'string')
				)
			: [];
	} catch {
		return [];
	}
};

export const d1UserSyncCapabilityAuthorizer: UserSyncCapabilityAuthorizer = {
	async authorize(input) {
		if (input.activeWorkOSMemberships.length === 0) {
			throw new ServerSyncCapabilityDenied({
				code: 'no_active_household',
				message: 'No current WorkOS household membership enables synchronization.'
			});
		}
		const placeholders = input.activeWorkOSMemberships.map(() => '?').join(', ');
		const result = await input.database
			.prepare(
				`SELECT hm.household_id, hm.membership_id, hm.role_slug, hm.permissions,
				        bs.status, bs.current_period_end, bs.grace_until, bs.stripe_subscription_id,
				        hdr.state AS deletion_state, hdr.stripe_cancellation_id
				 FROM household_memberships hm
				 LEFT JOIN billing_subscriptions bs ON bs.household_id = hm.household_id
				 LEFT JOIN household_deletion_requests hdr ON hdr.household_id = hm.household_id
				 WHERE hm.workos_user_id = ?
				   AND hm.status = 'active'
				   AND hm.household_id IN (${placeholders})`
			)
			.bind(
				input.workosUserId,
				...input.activeWorkOSMemberships.map(({ householdId }) => householdId)
			)
			.all<CapabilityRow>();
		const liveFor = (row: CapabilityRow) =>
			input.activeWorkOSMemberships.find(
				(membership) => membership.householdId === row.household_id
			);
		const enabled = result.results.filter((row) =>
			householdEnablesRemoteService(
				remoteServiceState(row),
				liveFor(row)?.billingGrant ?? false,
				input.now
			)
		);
		if (enabled.length === 0) {
			throw new ServerSyncCapabilityDenied({
				code: 'maal_plan_required',
				message: 'An active or grace Maal plan is required.'
			});
		}
		const permitted = enabled.find((row) => {
			const live = liveFor(row);
			return (
				live?.membershipId === row.membership_id &&
				live.roleSlug === row.role_slug &&
				live.permissions.includes(input.permission) &&
				permissionsFor(row.permissions).includes(input.permission)
			);
		});
		if (!permitted) {
			throw new ServerSyncPermissionDenied({
				code: 'recipes_permission_required',
				message: 'A current household membership does not grant the required recipe permission.'
			});
		}
		return { householdId: permitted.household_id, permission: input.permission };
	}
};

export const d1HouseholdSyncCapabilityAuthorizer: HouseholdSyncCapabilityAuthorizer = {
	async authorize(input) {
		const live = input.activeWorkOSMemberships.find(
			(membership) => membership.householdId === input.householdId
		);
		if (!live) {
			throw new ServerSyncPermissionDenied({
				code: 'workos_membership_missing',
				message: 'WorkOS does not report a current membership for this household.'
			});
		}
		const row = await input.database
			.prepare(
				`SELECT hm.household_id, hm.membership_id, hm.role_slug, hm.permissions,
				        bs.status, bs.current_period_end, bs.grace_until, bs.stripe_subscription_id,
				        hdr.state AS deletion_state, hdr.stripe_cancellation_id
				 FROM household_memberships hm
				 LEFT JOIN billing_subscriptions bs ON bs.household_id = hm.household_id
				 LEFT JOIN household_deletion_requests hdr ON hdr.household_id = hm.household_id
				 WHERE hm.household_id = ? AND hm.workos_user_id = ? AND hm.status = 'active'`
			)
			.bind(input.householdId, input.workosUserId)
			.first<CapabilityRow>();
		if (!row) {
			throw new ServerSyncPermissionDenied({
				code: 'membership_required',
				message: 'The current D1 membership projection denies this household.'
			});
		}
		if (row.deletion_state !== null && row.deletion_state !== 'recovered') {
			throw new ServerSyncCapabilityDenied({
				code: 'household_deletion_pending',
				message: 'Synchronization is disabled while household deletion is in progress.'
			});
		}
		if (
			row.membership_id !== live.membershipId ||
			row.role_slug !== live.roleSlug ||
			!live.permissions.includes(input.permission) ||
			!permissionsFor(row.permissions).includes(input.permission)
		) {
			throw new ServerSyncPermissionDenied({
				code: 'household_permission_required',
				message: 'The current household membership lacks the required permission.'
			});
		}
		if (
			!householdEnablesRemoteService(remoteServiceState(row), live.billingGrant ?? false, input.now)
		) {
			throw new ServerSyncCapabilityDenied({
				code: 'maal_plan_required',
				message: 'An active or grace Maal plan is required.'
			});
		}
		return { householdId: input.householdId, permission: input.permission };
	}
};
