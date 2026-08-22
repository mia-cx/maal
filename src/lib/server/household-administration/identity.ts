import { WorkOS } from '@workos-inc/node';

import type { HouseholdRole } from '$lib/domain/household/contracts.js';
import { readAuthSlotConfig } from '$lib/server/auth-slots/config.js';

import { HouseholdAdministrationError } from './errors.js';

export interface IdentityHousehold {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface IdentityMembership {
	readonly id: string;
	readonly householdId: string;
	readonly workosUserId: string;
	readonly roleSlug: HouseholdRole;
	readonly permissions: readonly string[];
	readonly directoryManaged: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface IdentityUser {
	readonly id: string;
	readonly displayName: string;
	readonly email: string;
	readonly profilePictureUrl: string | null;
}

export interface HouseholdIdentityAdapter {
	createHousehold(input: {
		readonly name: string;
		readonly idempotencyKey: string;
	}): Promise<IdentityHousehold>;
	deleteHousehold(householdId: string): Promise<void>;
	getHousehold(householdId: string): Promise<IdentityHousehold>;
	getUser(workosUserId: string): Promise<IdentityUser>;
	listMemberships(householdId: string): Promise<readonly IdentityMembership[]>;
	getMembership(membershipId: string): Promise<IdentityMembership | null>;
	findMembership(householdId: string, workosUserId: string): Promise<IdentityMembership | null>;
	createMembership(input: {
		readonly householdId: string;
		readonly workosUserId: string;
		readonly roleSlug: HouseholdRole;
	}): Promise<IdentityMembership>;
	updateMembershipRole(membershipId: string, roleSlug: HouseholdRole): Promise<IdentityMembership>;
	deleteMembership(membershipId: string): Promise<void>;
}

const householdRoles = new Set<HouseholdRole>(['admin', 'member', 'child']);

const decodeRole = (value: string): HouseholdRole => {
	if (!householdRoles.has(value as HouseholdRole)) {
		throw new HouseholdAdministrationError({ code: 'membership_projection_invalid' });
	}
	return value as HouseholdRole;
};

const displayName = (user: {
	firstName: string | null;
	lastName: string | null;
	email: string;
}): string =>
	[user.firstName, user.lastName].filter((part): part is string => Boolean(part)).join(' ') ||
	user.email;

export const createWorkOSHouseholdIdentityAdapter = (
	environment?: unknown
): HouseholdIdentityAdapter => {
	const config = readAuthSlotConfig(environment);
	const workos = new WorkOS(config.apiKey, { clientId: config.clientId });

	const permissionsFor = async (
		householdId: string,
		roleSlugs: readonly string[]
	): Promise<readonly string[]> => {
		const permissions = new Set<string>();
		for (const roleSlug of new Set(roleSlugs)) {
			const role = await workos.authorization
				.getOrganizationRole(householdId, roleSlug)
				.catch(() => workos.authorization.getEnvironmentRole(roleSlug));
			for (const permission of role.permissions) permissions.add(permission);
		}
		return [...permissions].sort();
	};

	const mapMembership = async (membership: {
		id: string;
		organizationId: string;
		userId: string;
		role: { slug: string };
		roles?: Array<{ slug: string }> | null;
		directoryManaged: boolean;
		createdAt: string;
		updatedAt: string;
	}): Promise<IdentityMembership> => {
		const roleSlugs = [membership.role.slug, ...(membership.roles ?? []).map(({ slug }) => slug)];
		return {
			id: membership.id,
			householdId: membership.organizationId,
			workosUserId: membership.userId,
			roleSlug: decodeRole(membership.role.slug),
			permissions: await permissionsFor(membership.organizationId, roleSlugs),
			directoryManaged: membership.directoryManaged,
			createdAt: membership.createdAt,
			updatedAt: membership.updatedAt
		};
	};

	return {
		async createHousehold({ name, idempotencyKey }) {
			const household = await workos.organizations.createOrganization({ name }, { idempotencyKey });
			return household;
		},
		deleteHousehold: (householdId) => workos.organizations.deleteOrganization(householdId),
		async getHousehold(householdId) {
			return workos.organizations.getOrganization(householdId);
		},
		async getUser(workosUserId) {
			const user = await workos.userManagement.getUser(workosUserId);
			return {
				id: user.id,
				displayName: displayName(user),
				email: user.email,
				profilePictureUrl: user.profilePictureUrl
			};
		},
		async listMemberships(householdId) {
			const page = await workos.userManagement.listOrganizationMemberships({
				organizationId: householdId,
				statuses: ['active']
			});
			return Promise.all((await page.autoPagination()).map(mapMembership));
		},
		async getMembership(membershipId) {
			try {
				return await mapMembership(
					await workos.userManagement.getOrganizationMembership(membershipId)
				);
			} catch (cause) {
				if (
					typeof cause === 'object' &&
					cause !== null &&
					'status' in cause &&
					cause.status === 404
				) {
					return null;
				}
				throw cause;
			}
		},
		async findMembership(householdId, workosUserId) {
			const page = await workos.userManagement.listOrganizationMemberships({
				organizationId: householdId,
				userId: workosUserId,
				statuses: ['active'],
				limit: 1
			});
			const membership = page.data[0];
			return membership ? mapMembership(membership) : null;
		},
		async createMembership({ householdId, workosUserId, roleSlug }) {
			return mapMembership(
				await workos.userManagement.createOrganizationMembership({
					organizationId: householdId,
					userId: workosUserId,
					roleSlug
				})
			);
		},
		async updateMembershipRole(membershipId, roleSlug) {
			return mapMembership(
				await workos.userManagement.updateOrganizationMembership(membershipId, { roleSlug })
			);
		},
		deleteMembership: (membershipId) =>
			workos.userManagement.deleteOrganizationMembership(membershipId)
	};
};
