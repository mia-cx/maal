import { uuidv7 } from 'uuidv7';

import type {
	HouseholdDeletionState,
	HouseholdInviteSummary,
	Membership
} from '$lib/domain/household/contracts.js';
import type { CreateRemoteHouseholdRequest } from '$lib/domain/household/administration.js';

import { HouseholdAdministrationError, asHouseholdAdministrationError } from './errors.js';
import type { IdentityMembership } from './identity.js';

interface HouseholdRow {
	household_id: string;
	locale: string;
	timezone: string | null;
	week_starts_on: number;
	default_planned_yield: number;
	preferred_dinner_time: string | null;
	created_by_user_id: string | null;
	schema_version: number;
	revision: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

interface MembershipRow {
	membership_id: string;
	household_id: string;
	workos_user_id: string;
	role_slug: 'admin' | 'member' | 'child';
	permissions: string;
	status: string;
	directory_managed: number;
	workos_created_at: string;
	last_verified_at: string;
	updated_at: string;
}

interface InviteRow {
	id: string;
	household_id: string;
	code_hash: string;
	created_by_user_id: string;
	role_slug: 'admin' | 'member' | 'child';
	max_uses: number | null;
	uses_count: number;
	expires_at: string;
	revoked_at: string | null;
	created_at: string;
}

const toUtc = (value: string): `${string}Z` => value as `${string}Z`;

const permissionsFrom = (value: string): readonly string[] => {
	try {
		const decoded: unknown = JSON.parse(value);
		if (!Array.isArray(decoded) || decoded.some((entry) => typeof entry !== 'string')) {
			throw new HouseholdAdministrationError({ code: 'membership_projection_invalid' });
		}
		return decoded;
	} catch (cause) {
		throw asHouseholdAdministrationError(cause, 'membership_projection_invalid');
	}
};

export const membershipFromRow = (row: MembershipRow): Membership => ({
	membershipId: row.membership_id,
	householdId: row.household_id,
	workosUserId: row.workos_user_id,
	roleSlug: row.role_slug,
	permissions: permissionsFrom(row.permissions).filter(
		(permission): permission is Membership['permissions'][number] =>
			permission === 'households:write' ||
			permission === 'recipes:read' ||
			permission === 'recipes:write' ||
			permission === 'meals:read' ||
			permission === 'meals:write'
	),
	status:
		row.status === 'active' || row.status === 'detached' || row.status === 'revoked'
			? row.status
			: 'revoked',
	directoryManaged: Boolean(row.directory_managed),
	workosCreatedAt: toUtc(row.workos_created_at),
	lastVerifiedAt: toUtc(row.last_verified_at),
	updatedAt: toUtc(row.updated_at),
	detachedAt: null,
	denialCode: null,
	source: 'workos'
});

export const inviteFromRow = (row: InviteRow): HouseholdInviteSummary => ({
	id: row.id as HouseholdInviteSummary['id'],
	householdId: row.household_id,
	createdByUserId: row.created_by_user_id,
	roleSlug: row.role_slug,
	maxUses: row.max_uses,
	usesCount: row.uses_count,
	expiresAt: toUtc(row.expires_at),
	revokedAt: row.revoked_at ? toUtc(row.revoked_at) : null,
	createdAt: toUtc(row.created_at)
});

const deletionStateFrom = (state: string | null): HouseholdDeletionState =>
	state === 'recoverable'
		? 'recoverable'
		: state === 'purged'
			? 'purged'
			: state === null || state === 'recovered'
				? 'active'
				: 'deletionPending';

export class HouseholdAdministrationRepository {
	constructor(readonly database: D1Database) {}

	async household(householdId: string): Promise<{
		row: HouseholdRow;
		deletionState: HouseholdDeletionState;
	} | null> {
		const row = await this.database
			.prepare('SELECT * FROM households WHERE household_id = ? AND deleted_at IS NULL')
			.bind(householdId)
			.first<HouseholdRow>();
		if (!row) return null;
		const deletion = await this.database
			.prepare('SELECT state FROM household_deletion_requests WHERE household_id = ?')
			.bind(householdId)
			.first<{ state: string }>();
		return { row, deletionState: deletionStateFrom(deletion?.state ?? null) };
	}

	async membership(householdId: string, workosUserId: string): Promise<Membership | null> {
		const row = await this.database
			.prepare(
				`SELECT * FROM household_memberships
				 WHERE household_id = ? AND workos_user_id = ?`
			)
			.bind(householdId, workosUserId)
			.first<MembershipRow>();
		return row ? membershipFromRow(row) : null;
	}

	async membershipById(membershipId: string): Promise<Membership | null> {
		const row = await this.database
			.prepare('SELECT * FROM household_memberships WHERE membership_id = ?')
			.bind(membershipId)
			.first<MembershipRow>();
		return row ? membershipFromRow(row) : null;
	}

	async invites(householdId: string): Promise<readonly HouseholdInviteSummary[]> {
		const result = await this.database
			.prepare('SELECT * FROM household_invites WHERE household_id = ? ORDER BY created_at DESC')
			.bind(householdId)
			.all<InviteRow>();
		return result.results.map(inviteFromRow);
	}

	async inviteByCodeHash(codeHash: string): Promise<InviteRow | null> {
		return this.database
			.prepare('SELECT * FROM household_invites WHERE code_hash = ?')
			.bind(codeHash)
			.first<InviteRow>();
	}

	async createInvite(input: {
		householdId: string;
		codeHash: string;
		createdByUserId: string;
		roleSlug: InviteRow['role_slug'];
		maxUses: number | null;
		expiresAt: string;
		now: string;
	}): Promise<HouseholdInviteSummary> {
		const id = uuidv7();
		await this.database
			.prepare(
				`INSERT INTO household_invites
				 (id, household_id, code_hash, created_by_user_id, role_slug, max_uses,
				  uses_count, expires_at, revoked_at, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
				 ON CONFLICT(code_hash) DO NOTHING`
			)
			.bind(
				id,
				input.householdId,
				input.codeHash,
				input.createdByUserId,
				input.roleSlug,
				input.maxUses,
				input.expiresAt,
				input.now
			)
			.run();
		const row = await this.inviteByCodeHash(input.codeHash);
		if (!row) throw new HouseholdAdministrationError({ code: 'projection_write_failed' });
		if (
			row.household_id !== input.householdId ||
			row.created_by_user_id !== input.createdByUserId ||
			row.role_slug !== input.roleSlug ||
			row.max_uses !== input.maxUses
		) {
			throw new HouseholdAdministrationError({ code: 'invite_conflict' });
		}
		return inviteFromRow(row);
	}

	async revokeInvite(
		householdId: string,
		inviteId: string,
		now: string
	): Promise<HouseholdInviteSummary | null> {
		await this.database
			.prepare(
				`UPDATE household_invites
				 SET revoked_at = COALESCE(revoked_at, ?)
				 WHERE household_id = ? AND id = ?`
			)
			.bind(now, householdId, inviteId)
			.run();
		const row = await this.database
			.prepare('SELECT * FROM household_invites WHERE household_id = ? AND id = ?')
			.bind(householdId, inviteId)
			.first<InviteRow>();
		return row ? inviteFromRow(row) : null;
	}

	async claimInviteUse(inviteId: string, now: string): Promise<InviteRow | null> {
		return this.database
			.prepare(
				`UPDATE household_invites
				 SET uses_count = uses_count + 1
				 WHERE id = ?
				   AND revoked_at IS NULL
				   AND expires_at > ?
				   AND (max_uses IS NULL OR uses_count < max_uses)
				 RETURNING *`
			)
			.bind(inviteId, now)
			.first<InviteRow>();
	}

	async releaseInviteUse(inviteId: string): Promise<void> {
		await this.database
			.prepare(
				`UPDATE household_invites
				 SET uses_count = uses_count - 1
				 WHERE id = ? AND uses_count > 0`
			)
			.bind(inviteId)
			.run();
	}

	async projectCreatedHousehold(input: {
		workosUserId: string;
		householdId: string;
		membership: IdentityMembership;
		settings: CreateRemoteHouseholdRequest;
		now: string;
	}): Promise<void> {
		try {
			await this.database.batch([
				this.database
					.prepare(
						`INSERT INTO users (workos_user_id, locale, timezone)
						 VALUES (?, ?, ?)
						 ON CONFLICT(workos_user_id) DO UPDATE SET
						  locale = excluded.locale,
						  timezone = excluded.timezone,
						  updated_at = ?`
					)
					.bind(input.workosUserId, input.settings.locale, input.settings.timezone, input.now),
				this.database
					.prepare(
						`INSERT INTO households
						 (household_id, name, locale, timezone, week_starts_on, default_planned_yield,
						  preferred_dinner_time, created_by_user_id, schema_version, revision,
						  created_at, updated_at, deleted_at)
						 VALUES (?, ?, ?, ?, 1, 4, NULL, ?, 1, 1, ?, ?, NULL)
						 ON CONFLICT(household_id) DO NOTHING`
					)
					.bind(
						input.householdId,
						input.settings.name,
						input.settings.locale,
						input.settings.timezone,
						input.workosUserId,
						input.now,
						input.now
					),
				this.membershipStatement(input.membership, input.now)
			]);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'projection_write_failed');
		}
	}

	async projectMemberships(
		householdId: string,
		memberships: readonly IdentityMembership[],
		now: string
	): Promise<void> {
		const statements: D1PreparedStatement[] = [];
		for (const membership of memberships) {
			statements.push(
				this.database
					.prepare('INSERT INTO users (workos_user_id) VALUES (?) ON CONFLICT DO NOTHING')
					.bind(membership.workosUserId),
				this.membershipStatement(membership, now)
			);
		}
		const ids = memberships.map(({ id }) => id);
		const predicate =
			ids.length === 0 ? '' : ` AND membership_id NOT IN (${ids.map(() => '?').join(', ')})`;
		statements.push(
			this.database
				.prepare(
					`UPDATE household_memberships
					 SET status = 'revoked', updated_at = ?
					 WHERE household_id = ? AND status = 'active'${predicate}`
				)
				.bind(now, householdId, ...ids)
		);
		try {
			await this.database.batch(statements);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'projection_write_failed');
		}
	}

	async projectMembership(membership: IdentityMembership, now: string): Promise<void> {
		try {
			await this.database.batch([
				this.database
					.prepare('INSERT INTO users (workos_user_id) VALUES (?) ON CONFLICT DO NOTHING')
					.bind(membership.workosUserId),
				this.membershipStatement(membership, now)
			]);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'projection_write_failed');
		}
	}

	async markMembershipRevoked(membershipId: string, now: string): Promise<void> {
		try {
			await this.database
				.prepare(
					`UPDATE household_memberships
					 SET status = 'revoked', last_verified_at = ?, updated_at = ?
					 WHERE membership_id = ?`
				)
				.bind(now, now, membershipId)
				.run();
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'projection_write_failed');
		}
	}

	async activeBillingOwner(householdId: string, now: string): Promise<string | null> {
		const row = await this.database
			.prepare(
				`SELECT subscriber_user_id
				 FROM billing_subscriptions
				 WHERE household_id = ?
				   AND (
				     (status IN ('active', 'trialing') AND current_period_end > ?)
				     OR (status IN ('past_due', 'paused') AND grace_until IS NOT NULL AND grace_until > ?)
				   )`
			)
			.bind(householdId, now, now)
			.first<{ subscriber_user_id: string | null }>();
		return row?.subscriber_user_id ?? null;
	}

	async withMembershipMutationLock<A>(householdId: string, mutation: () => Promise<A>): Promise<A> {
		const ownerToken = crypto.randomUUID();
		const now = new Date().toISOString();
		const expiresAt = new Date(Date.parse(now) + 60_000).toISOString();
		await this.database
			.prepare(
				'DELETE FROM household_membership_mutation_locks WHERE household_id = ? AND expires_at <= ?'
			)
			.bind(householdId, now)
			.run();
		const acquired = await this.database
			.prepare(
				`INSERT INTO household_membership_mutation_locks
				 (household_id, owner_token, expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(household_id) DO NOTHING
				 RETURNING owner_token`
			)
			.bind(householdId, ownerToken, expiresAt, now, now)
			.first<{ owner_token: string }>();
		if (!acquired) throw new HouseholdAdministrationError({ code: 'mutation_busy' });
		try {
			return await mutation();
		} finally {
			await this.database
				.prepare(
					`DELETE FROM household_membership_mutation_locks
					 WHERE household_id = ? AND owner_token = ?`
				)
				.bind(householdId, ownerToken)
				.run();
		}
	}

	private membershipStatement(membership: IdentityMembership, now: string): D1PreparedStatement {
		return this.database
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
				  workos_created_at = excluded.workos_created_at,
				  last_verified_at = excluded.last_verified_at,
				  updated_at = excluded.updated_at`
			)
			.bind(
				membership.id,
				membership.householdId,
				membership.workosUserId,
				membership.roleSlug,
				JSON.stringify(membership.permissions),
				membership.directoryManaged ? 1 : 0,
				membership.createdAt,
				now,
				now
			);
	}
}
