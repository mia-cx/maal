import { Schema } from 'effect';

import { projectBillingCapability } from '$lib/domain/billing/capability.js';
import {
	StripeSubscriptionStatusSchema,
	type BillingCapability
} from '$lib/domain/billing/contracts.js';
import {
	householdPermissionValues,
	HouseholdRoleSchema,
	type Household,
	type HouseholdPermission,
	type Membership
} from '$lib/domain/household/contracts.js';
import type { HouseholdDiscoveryEntry } from '$lib/domain/household/administration.js';

import type { LiveWorkOSMembership } from './adapter.js';

interface DiscoveryRow {
	household_id: string;
	name: string;
	locale: string;
	timezone: string | null;
	week_starts_on: 0 | 1;
	default_planned_yield: number;
	preferred_dinner_time: string | null;
	created_by_user_id: string | null;
	schema_version: 1;
	revision: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	billing_status: string | null;
	subscriber_user_id: string | null;
	stripe_price_id: string | null;
	current_period_end: string | null;
	cancel_at_period_end: number | null;
	interruption_started_at: string | null;
	grace_until: string | null;
	deletion_state: string | null;
}

const supportedPermissions = (permissions: readonly string[]): readonly HouseholdPermission[] =>
	permissions.filter((permission): permission is HouseholdPermission =>
		(householdPermissionValues as readonly string[]).includes(permission)
	);

const localDeletionState = (state: string | null): Household['deletionState'] =>
	state === 'purged'
		? 'purged'
		: state === 'recoverable'
			? 'recoverable'
			: state === null || state === 'recovered'
				? 'active'
				: 'deletionPending';

const capabilityFor = (row: DiscoveryRow, now: string): BillingCapability => {
	const status = Schema.is(StripeSubscriptionStatusSchema)(row.billing_status)
		? row.billing_status
		: null;
	const projected = projectBillingCapability(
		{
			householdId: row.household_id,
			status,
			subscriberUserId: row.subscriber_user_id,
			stripePriceId: row.stripe_price_id,
			currentPeriodEnd: row.current_period_end,
			cancelAtPeriodEnd: row.cancel_at_period_end === 1,
			interruptionStartedAt: row.interruption_started_at,
			graceUntil: row.grace_until
		},
		now
	);
	return row.deletion_state === null || row.deletion_state === 'recovered'
		? projected
		: { ...projected, state: 'disabled', validUntil: null };
};

export const discoverActiveHouseholds = async (input: {
	database: D1Database;
	workosUserId: string;
	liveMemberships: readonly LiveWorkOSMembership[];
	now: string;
}): Promise<readonly HouseholdDiscoveryEntry[]> => {
	const memberships = input.liveMemberships.map((live) => ({
		live,
		roleSlug: Schema.decodeUnknownSync(HouseholdRoleSchema)(live.roleSlug),
		permissions: supportedPermissions(live.permissions)
	}));
	if (memberships.length === 0) return [];

	const writes: D1PreparedStatement[] = [
		input.database
			.prepare('INSERT INTO users (workos_user_id) VALUES (?) ON CONFLICT DO NOTHING')
			.bind(input.workosUserId)
	];
	for (const { live, roleSlug, permissions } of memberships) {
		writes.push(
			input.database
				.prepare(
					`INSERT INTO households (household_id, name)
					 VALUES (?, ?)
					 ON CONFLICT(household_id) DO UPDATE SET
					  name = CASE WHEN households.name = 'Household' THEN excluded.name ELSE households.name END`
				)
				.bind(live.householdId, live.householdName),
			input.database
				.prepare(
					`INSERT INTO household_memberships
					 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
					  directory_managed, workos_created_at, last_verified_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
					 ON CONFLICT(household_id, workos_user_id) DO UPDATE SET
					  membership_id = excluded.membership_id,
					  role_slug = excluded.role_slug,
					  permissions = excluded.permissions,
					  status = 'active',
					  directory_managed = excluded.directory_managed,
					  last_verified_at = excluded.last_verified_at,
					  updated_at = excluded.updated_at`
				)
				.bind(
					live.membershipId,
					live.householdId,
					input.workosUserId,
					roleSlug,
					JSON.stringify(permissions),
					live.directoryManaged ? 1 : 0,
					live.workosCreatedAt ?? input.now,
					input.now,
					input.now
				)
		);
	}
	await input.database.batch(writes);

	return Promise.all(
		memberships.map(async ({ live, roleSlug, permissions }): Promise<HouseholdDiscoveryEntry> => {
			const row = await input.database
				.prepare(
					`SELECT h.*,
					 bs.status AS billing_status, bs.subscriber_user_id, bs.stripe_price_id,
					 bs.current_period_end, bs.cancel_at_period_end, bs.interruption_started_at,
					 bs.grace_until, hdr.state AS deletion_state
					 FROM households h
					 LEFT JOIN billing_subscriptions bs ON bs.household_id = h.household_id
					 LEFT JOIN household_deletion_requests hdr ON hdr.household_id = h.household_id
					 WHERE h.household_id = ?`
				)
				.bind(live.householdId)
				.first<DiscoveryRow>();
			if (!row) throw new TypeError('The discovered household projection is missing.');
			const household: Household = {
				householdId: row.household_id,
				name: row.name,
				locale: row.locale,
				timezone: row.timezone,
				weekStartsOn: row.week_starts_on,
				defaultPlannedYield: row.default_planned_yield,
				preferredDinnerTime: row.preferred_dinner_time,
				createdByUserId: row.created_by_user_id,
				deletionState: localDeletionState(row.deletion_state),
				localOnly: false,
				schemaVersion: row.schema_version,
				revision: row.revision,
				createdAt: row.created_at as `${string}Z`,
				updatedAt: row.updated_at as `${string}Z`,
				deletedAt: row.deleted_at as `${string}Z` | null,
				conflictClocks: {}
			};
			const membership: Membership = {
				membershipId: live.membershipId,
				householdId: live.householdId,
				workosUserId: input.workosUserId,
				roleSlug,
				permissions,
				status: 'active',
				directoryManaged: live.directoryManaged ?? false,
				workosCreatedAt: (live.workosCreatedAt ?? input.now) as `${string}Z`,
				lastVerifiedAt: input.now as `${string}Z`,
				updatedAt: input.now as `${string}Z`,
				detachedAt: null,
				denialCode: null,
				source: 'workos'
			};
			return { household, membership, capability: capabilityFor(row, input.now) };
		})
	);
};
