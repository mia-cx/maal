import { displayUserName } from '$lib/server/auth/user-display';
import { householdRoleSlug } from '$lib/server/auth/household-invites';
import { createAuthRuntime } from '$lib/server/auth/workos';

export type HouseholdMemberRow = {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: 'admin' | 'member' | 'child';
	directoryManaged: boolean;
	createdAt: string | null;
};

export const canCurrentUserLeaveHousehold = (
	members: HouseholdMemberRow[],
	currentUserId: string
): { canLeave: boolean; reason: string | null } => {
	const currentMember = members.find((member) => member.userId === currentUserId);
	if (!currentMember) return { canLeave: false, reason: 'You are not a member of this household.' };
	const adminCount = members.filter((member) => member.role === 'admin').length;
	if (currentMember.role === 'admin' && adminCount <= 1) {
		return {
			canLeave: false,
			reason: 'You are the last manager. Add another manager or delete the household instead.'
		};
	}
	return { canLeave: true, reason: null };
};

export const membershipHasAdminRole = (membership: {
	role: { slug: string };
	roles?: Array<{ slug: string }> | null;
}): boolean =>
	membership.role.slug === 'admin' ||
	Boolean(membership.roles?.some((role) => role.slug === 'admin'));

export const loadMembers = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<HouseholdMemberRow[]> => {
	const runtime = createAuthRuntime(platform);
	const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
		organizationId: householdId,
		statuses: ['active'],
		limit: 100
	});

	return Promise.all(
		memberships.data.map(async (membership) => {
			try {
				const user = await runtime.workos.userManagement.getUser(membership.userId);
				return {
					id: membership.id,
					userId: membership.userId,
					name: displayUserName(user),
					email: user.email,
					role: householdRoleSlug(membership.role.slug),
					directoryManaged: membership.directoryManaged,
					createdAt: membership.createdAt
				};
			} catch {
				return {
					id: membership.id,
					userId: membership.userId,
					name: membership.userId,
					email: '',
					role: householdRoleSlug(membership.role.slug),
					directoryManaged: membership.directoryManaged,
					createdAt: membership.createdAt
				};
			}
		})
	);
};
