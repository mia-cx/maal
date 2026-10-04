import type {
	CreateRemoteHouseholdInviteRequest,
	CreateRemoteHouseholdRequest,
	HouseholdAdministrationProjection,
	HouseholdMemberIdentity
} from '$lib/domain/household/administration.js';
import type {
	Household,
	HouseholdInviteSummary,
	HouseholdPermission,
	HouseholdRole,
	Membership
} from '$lib/domain/household/contracts.js';
import { hashInviteCode, inviteExpiresAt } from '$lib/domain/household/invites.js';

import { HouseholdAdministrationError, asHouseholdAdministrationError } from './errors.js';
import type {
	HouseholdIdentityAdapter,
	IdentityHousehold,
	IdentityMembership
} from './identity.js';
import { HouseholdAdministrationRepository } from './repository.js';

export interface HouseholdAdministrationActor {
	readonly authSlotId: string;
	readonly workosUserId: string;
	readonly activeOrganizationIds: readonly string[];
}

const asUtc = (value: string): `${string}Z` => value as `${string}Z`;

const isAdmin = (membership: IdentityMembership): boolean => membership.roleSlug === 'admin';

const membershipPermissionsInclude = (
	membership: Pick<IdentityMembership, 'permissions'> | Pick<Membership, 'permissions'>,
	permission: HouseholdPermission
): boolean => membership.permissions.includes(permission);

export class HouseholdAdministrationService {
	constructor(
		readonly repository: HouseholdAdministrationRepository,
		readonly identity: HouseholdIdentityAdapter,
		readonly now: () => string = () => new Date().toISOString()
	) {}

	async createHousehold(input: {
		actor: HouseholdAdministrationActor;
		request: CreateRemoteHouseholdRequest;
		idempotencyKey: string;
	}): Promise<HouseholdAdministrationProjection> {
		let household: IdentityHousehold;
		try {
			household = await this.identity.createHousehold({
				name: input.request.name,
				idempotencyKey: `maal-household:${input.actor.workosUserId}:${input.idempotencyKey}`
			});
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'workos_unavailable');
		}
		const completedProjection = await this.repository.household(household.id);
		if (completedProjection) {
			const existingMembership = await this.identityMembershipForUser(
				household.id,
				input.actor.workosUserId
			);
			if (!existingMembership) {
				throw new HouseholdAdministrationError({ code: 'membership_inactive' });
			}
			return this.loadProjectionWithoutPriorIntersection(
				input.actor.workosUserId,
				household,
				existingMembership
			);
		}

		let membership: IdentityMembership | null = null;
		let createdMembership = false;
		try {
			membership = await this.identity.findMembership(household.id, input.actor.workosUserId);
			if (!membership) {
				membership = await this.identity.createMembership({
					householdId: household.id,
					workosUserId: input.actor.workosUserId,
					roleSlug: 'admin'
				});
				createdMembership = true;
			}
		} catch (cause) {
			await this.compensate([() => this.identity.deleteHousehold(household.id)], cause);
		}

		try {
			await this.repository.projectCreatedHousehold({
				workosUserId: input.actor.workosUserId,
				householdId: household.id,
				membership: membership!,
				settings: input.request,
				now: this.now()
			});
		} catch (cause) {
			await this.compensate(
				[
					...(createdMembership && membership
						? [() => this.identity.deleteMembership(membership.id)]
						: []),
					() => this.identity.deleteHousehold(household.id)
				],
				cause
			);
		}

		return this.loadProjectionWithoutPriorIntersection(
			input.actor.workosUserId,
			household,
			membership!
		);
	}

	async joinHousehold(input: {
		actor: HouseholdAdministrationActor;
		code: string;
	}): Promise<HouseholdAdministrationProjection> {
		let codeHash: string;
		try {
			codeHash = await hashInviteCode(input.code);
		} catch (cause) {
			throw new HouseholdAdministrationError({ code: 'invite_invalid', cause });
		}
		const initialInvite = await this.repository.inviteByCodeHash(codeHash);
		if (!initialInvite) throw new HouseholdAdministrationError({ code: 'invite_invalid' });

		return this.repository.withMembershipMutationLock(initialInvite.household_id, async () => {
			const invite = await this.repository.inviteByCodeHash(codeHash);
			if (!invite) throw new HouseholdAdministrationError({ code: 'invite_invalid' });

			let existing: IdentityMembership | null;
			try {
				existing = await this.identity.findMembership(
					invite.household_id,
					input.actor.workosUserId
				);
			} catch (cause) {
				throw asHouseholdAdministrationError(cause, 'workos_unavailable');
			}
			if (existing) {
				await this.repository.projectMembership(existing, this.now());
				return this.loadProjectionWithoutPriorIntersection(
					input.actor.workosUserId,
					await this.identityHousehold(invite.household_id),
					existing
				);
			}

			this.assertInviteUsable(invite, this.now());
			const consumed = await this.repository.claimInviteUse(invite.id, this.now());
			if (!consumed) {
				const current = await this.repository.inviteByCodeHash(codeHash);
				if (!current) throw new HouseholdAdministrationError({ code: 'invite_invalid' });
				this.assertInviteUsable(current, this.now());
				throw new HouseholdAdministrationError({ code: 'invite_conflict' });
			}

			let membership: IdentityMembership;
			try {
				membership = await this.identity.createMembership({
					householdId: consumed.household_id,
					workosUserId: input.actor.workosUserId,
					roleSlug: consumed.role_slug
				});
			} catch (cause) {
				await this.compensate([() => this.repository.releaseInviteUse(consumed.id)], cause);
			}

			try {
				await this.repository.projectMembership(membership!, this.now());
			} catch (cause) {
				await this.compensate(
					[
						() => this.identity.deleteMembership(membership.id),
						() => this.repository.releaseInviteUse(consumed.id)
					],
					cause
				);
			}

			return this.loadProjectionWithoutPriorIntersection(
				input.actor.workosUserId,
				await this.identityHousehold(consumed.household_id),
				membership!
			);
		});
	}

	async refreshHousehold(
		actor: HouseholdAdministrationActor,
		householdId: string
	): Promise<HouseholdAdministrationProjection> {
		const { live } = await this.requireIntersection(actor, householdId, null);
		return this.loadProjectionWithoutPriorIntersection(
			actor.workosUserId,
			await this.identityHousehold(householdId),
			live
		);
	}

	async createInvite(input: {
		actor: HouseholdAdministrationActor;
		householdId: string;
		request: CreateRemoteHouseholdInviteRequest;
	}): Promise<HouseholdInviteSummary> {
		if (input.request.householdId !== input.householdId) {
			throw new HouseholdAdministrationError({ code: 'malformed_request' });
		}
		await this.requireIntersection(input.actor, input.householdId, 'households:write');
		let codeHash: string;
		try {
			codeHash = await hashInviteCode(input.request.code);
		} catch (cause) {
			throw new HouseholdAdministrationError({ code: 'invite_invalid', cause });
		}
		const now = this.now();
		return this.repository.createInvite({
			householdId: input.householdId,
			codeHash,
			createdByUserId: input.actor.workosUserId,
			roleSlug: input.request.roleSlug,
			maxUses: input.request.maxUses,
			expiresAt: inviteExpiresAt(input.request.expiresInDays, Date.parse(now)),
			now
		});
	}

	async revokeInvite(input: {
		actor: HouseholdAdministrationActor;
		householdId: string;
		inviteId: string;
	}): Promise<HouseholdInviteSummary> {
		await this.requireIntersection(input.actor, input.householdId, 'households:write');
		const invite = await this.repository.revokeInvite(
			input.householdId,
			input.inviteId,
			this.now()
		);
		if (!invite) throw new HouseholdAdministrationError({ code: 'household_not_found' });
		return invite;
	}

	async updateMemberRole(input: {
		actor: HouseholdAdministrationActor;
		householdId: string;
		membershipId: string;
		roleSlug: HouseholdRole;
	}): Promise<Membership> {
		return this.repository.withMembershipMutationLock(input.householdId, async () => {
			await this.requireIntersection(input.actor, input.householdId, 'households:write');
			const [target, members] = await Promise.all([
				this.identityMembership(input.membershipId),
				this.identityMemberships(input.householdId)
			]);
			if (!target || target.householdId !== input.householdId) {
				throw new HouseholdAdministrationError({ code: 'membership_not_found' });
			}
			if (target.directoryManaged) {
				throw new HouseholdAdministrationError({ code: 'directory_managed' });
			}
			if (target.workosUserId === input.actor.workosUserId && input.roleSlug !== 'admin') {
				throw new HouseholdAdministrationError({ code: 'permission_denied' });
			}
			if (
				input.roleSlug !== 'admin' &&
				(await this.repository.activeBillingOwner(input.householdId, this.now())) ===
					target.workosUserId
			) {
				throw new HouseholdAdministrationError({ code: 'billing_owner_required' });
			}
			if (isAdmin(target) && input.roleSlug !== 'admin' && members.filter(isAdmin).length <= 1) {
				throw new HouseholdAdministrationError({ code: 'last_admin' });
			}
			if (target.roleSlug === input.roleSlug) {
				await this.repository.projectMembership(target, this.now());
				return (await this.repository.membershipById(target.id))!;
			}

			let updated: IdentityMembership;
			try {
				updated = await this.identity.updateMembershipRole(target.id, input.roleSlug);
			} catch (cause) {
				throw asHouseholdAdministrationError(cause, 'workos_unavailable');
			}
			try {
				await this.repository.projectMembership(updated, this.now());
			} catch (cause) {
				await this.compensate(
					[
						() =>
							this.identity.updateMembershipRole(target.id, target.roleSlug).then(() => undefined)
					],
					cause
				);
			}
			return (await this.repository.membershipById(updated.id))!;
		});
	}

	async removeMember(input: {
		actor: HouseholdAdministrationActor;
		householdId: string;
		membershipId: string;
	}): Promise<void> {
		await this.repository.withMembershipMutationLock(input.householdId, async () => {
			await this.requireIntersection(input.actor, input.householdId, 'households:write');
			if ((await this.repository.membershipById(input.membershipId))?.status === 'revoked') {
				return;
			}
			const [target, members] = await Promise.all([
				this.identityMembership(input.membershipId),
				this.identityMemberships(input.householdId)
			]);
			if (!target || target.householdId !== input.householdId) {
				throw new HouseholdAdministrationError({ code: 'membership_not_found' });
			}
			if (target.workosUserId === input.actor.workosUserId) {
				throw new HouseholdAdministrationError({ code: 'permission_denied' });
			}
			if (
				(await this.repository.activeBillingOwner(input.householdId, this.now())) ===
				target.workosUserId
			) {
				throw new HouseholdAdministrationError({ code: 'billing_owner_required' });
			}
			this.assertRemovable(target, members);
			await this.deleteMembershipWithCompensation(target);
		});
	}

	async leaveHousehold(input: {
		actor: HouseholdAdministrationActor;
		householdId: string;
	}): Promise<string> {
		return this.repository.withMembershipMutationLock(input.householdId, async () => {
			const alreadyLeft = await this.repository.membership(
				input.householdId,
				input.actor.workosUserId
			);
			if (alreadyLeft?.status === 'revoked') return alreadyLeft.membershipId;
			const { live } = await this.requireIntersection(input.actor, input.householdId, null);
			const members = await this.identityMemberships(input.householdId);
			this.assertRemovable(live, members);
			if (
				(await this.repository.activeBillingOwner(input.householdId, this.now())) ===
				input.actor.workosUserId
			) {
				throw new HouseholdAdministrationError({ code: 'billing_owner_required' });
			}
			await this.deleteMembershipWithCompensation(live);
			return live.id;
		});
	}

	private async requireIntersection(
		actor: HouseholdAdministrationActor,
		householdId: string,
		permission: HouseholdPermission | null
	): Promise<{ live: IdentityMembership; projected: Membership }> {
		if (!actor.activeOrganizationIds.includes(householdId)) {
			throw new HouseholdAdministrationError({ code: 'membership_inactive' });
		}
		const [live, projected] = await Promise.all([
			this.identityMembershipForUser(householdId, actor.workosUserId),
			this.repository.membership(householdId, actor.workosUserId)
		]);
		if (!live) throw new HouseholdAdministrationError({ code: 'membership_inactive' });
		if (!projected) {
			throw new HouseholdAdministrationError({ code: 'membership_projection_missing' });
		}
		if (projected.status !== 'active') {
			throw new HouseholdAdministrationError({ code: 'membership_inactive' });
		}
		if (
			permission &&
			(!membershipPermissionsInclude(live, permission) ||
				!membershipPermissionsInclude(projected, permission))
		) {
			throw new HouseholdAdministrationError({ code: 'permission_denied' });
		}
		return { live, projected };
	}

	private async loadProjectionWithoutPriorIntersection(
		actorUserId: string,
		identityHousehold: IdentityHousehold,
		actorMembership: IdentityMembership
	): Promise<HouseholdAdministrationProjection> {
		const members = await this.identityMemberships(identityHousehold.id);
		if (!members.some(({ id }) => id === actorMembership.id)) {
			throw new HouseholdAdministrationError({ code: 'membership_inactive' });
		}
		await this.repository.projectMemberships(identityHousehold.id, members, this.now());
		const [storedHousehold, invites, identities] = await Promise.all([
			this.repository.household(identityHousehold.id),
			this.repository.invites(identityHousehold.id),
			Promise.all(members.map((membership) => this.memberIdentity(membership.workosUserId)))
		]);
		if (!storedHousehold) {
			throw new HouseholdAdministrationError({ code: 'household_not_found' });
		}
		const projectedMemberships = await Promise.all(
			members.map(({ workosUserId }) =>
				this.repository.membership(identityHousehold.id, workosUserId)
			)
		);
		const memberProjections = projectedMemberships.map((membership, index) => {
			if (!membership) {
				throw new HouseholdAdministrationError({ code: 'projection_write_failed' });
			}
			return { membership, user: identities[index]! };
		});
		const actor = memberProjections.find(
			({ membership }) => membership.workosUserId === actorUserId
		)?.membership;
		if (!actor) throw new HouseholdAdministrationError({ code: 'membership_inactive' });

		return {
			household: this.householdProjection(identityHousehold, storedHousehold),
			membership: actor,
			members: memberProjections,
			invites
		};
	}

	private householdProjection(
		identity: IdentityHousehold,
		stored: NonNullable<Awaited<ReturnType<HouseholdAdministrationRepository['household']>>>
	): Household {
		return {
			householdId: identity.id,
			name: identity.name,
			locale: stored.row.locale,
			timezone: stored.row.timezone,
			weekStartsOn: stored.row.week_starts_on === 0 ? 0 : 1,
			defaultPlannedYield: stored.row.default_planned_yield,
			preferredDinnerTime: stored.row.preferred_dinner_time as Household['preferredDinnerTime'],
			createdByUserId: stored.row.created_by_user_id,
			deletionState: stored.deletionState,
			localOnly: false,
			schemaVersion: 1,
			revision: stored.row.revision,
			createdAt: asUtc(stored.row.created_at),
			updatedAt: asUtc(stored.row.updated_at),
			deletedAt: stored.row.deleted_at ? asUtc(stored.row.deleted_at) : null,
			conflictClocks: {}
		};
	}

	private async memberIdentity(workosUserId: string): Promise<HouseholdMemberIdentity> {
		try {
			const user = await this.identity.getUser(workosUserId);
			return {
				workosUserId: user.id,
				displayName: user.displayName,
				email: user.email,
				profilePictureUrl: user.profilePictureUrl
			};
		} catch {
			return {
				workosUserId,
				displayName: workosUserId,
				email: null,
				profilePictureUrl: null
			};
		}
	}

	private async identityHousehold(householdId: string): Promise<IdentityHousehold> {
		try {
			return await this.identity.getHousehold(householdId);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'workos_unavailable');
		}
	}

	private async identityMemberships(householdId: string): Promise<readonly IdentityMembership[]> {
		try {
			return await this.identity.listMemberships(householdId);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'workos_unavailable');
		}
	}

	private async identityMembership(membershipId: string): Promise<IdentityMembership | null> {
		try {
			return await this.identity.getMembership(membershipId);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'workos_unavailable');
		}
	}

	private async identityMembershipForUser(
		householdId: string,
		workosUserId: string
	): Promise<IdentityMembership | null> {
		try {
			return await this.identity.findMembership(householdId, workosUserId);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'workos_unavailable');
		}
	}

	private assertInviteUsable(
		invite: {
			revoked_at: string | null;
			expires_at: string;
			max_uses: number | null;
			uses_count: number;
		},
		now: string
	): void {
		if (invite.revoked_at) throw new HouseholdAdministrationError({ code: 'invite_revoked' });
		if (invite.expires_at <= now) {
			throw new HouseholdAdministrationError({ code: 'invite_expired' });
		}
		if (invite.max_uses !== null && invite.uses_count >= invite.max_uses) {
			throw new HouseholdAdministrationError({ code: 'invite_exhausted' });
		}
	}

	private assertRemovable(
		target: IdentityMembership,
		members: readonly IdentityMembership[]
	): void {
		if (target.directoryManaged) {
			throw new HouseholdAdministrationError({ code: 'directory_managed' });
		}
		if (isAdmin(target) && members.filter(isAdmin).length <= 1) {
			throw new HouseholdAdministrationError({ code: 'last_admin' });
		}
	}

	private async deleteMembershipWithCompensation(target: IdentityMembership): Promise<void> {
		try {
			await this.identity.deleteMembership(target.id);
		} catch (cause) {
			throw asHouseholdAdministrationError(cause, 'workos_unavailable');
		}
		try {
			await this.repository.markMembershipRevoked(target.id, this.now());
		} catch (cause) {
			await this.compensate(
				[
					() =>
						this.identity
							.createMembership({
								householdId: target.householdId,
								workosUserId: target.workosUserId,
								roleSlug: target.roleSlug
							})
							.then((restored) => this.repository.projectMembership(restored, this.now()))
				],
				cause
			);
		}
	}

	private async compensate(
		actions: readonly (() => Promise<void>)[],
		cause: unknown
	): Promise<never> {
		let compensationFailed = false;
		for (const action of actions) {
			try {
				await action();
			} catch {
				compensationFailed = true;
			}
		}
		if (compensationFailed) {
			throw new HouseholdAdministrationError({ code: 'compensation_failed', cause });
		}
		throw asHouseholdAdministrationError(cause, 'workos_unavailable');
	}
}
