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

export const lastManagerMessage =
	'You are the last manager. Add another manager or delete the household instead.';

export const isLastAdmin = ({ isAdmin, adminCount }: { isAdmin: boolean; adminCount: number }) =>
	isAdmin && adminCount <= 1;

export const canCurrentUserLeaveHousehold = (
	members: HouseholdMemberRow[],
	currentUserId: string
): { canLeave: boolean; reason: string | null } => {
	const currentMember = members.find((member) => member.userId === currentUserId);
	if (!currentMember) return { canLeave: false, reason: 'You are not a member of this household.' };
	const adminCount = members.filter((member) => member.role === 'admin').length;
	if (isLastAdmin({ isAdmin: currentMember.role === 'admin', adminCount })) {
		return { canLeave: false, reason: lastManagerMessage };
	}
	return { canLeave: true, reason: null };
};

export const membershipHasAdminRole = (membership: {
	role: { slug: string };
	roles?: Array<{ slug: string }> | null;
}): boolean =>
	membership.role.slug === 'admin' ||
	Boolean(membership.roles?.some((role) => role.slug === 'admin'));

export const listActiveHouseholdMemberships = async (
	platform: App.Platform | undefined,
	householdId: string
) => {
	const runtime = createAuthRuntime(platform);
	return (
		await runtime.workos.userManagement.listOrganizationMemberships({
			organizationId: householdId,
			statuses: ['active']
		})
	).autoPagination();
};

export const loadMembers = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<HouseholdMemberRow[]> => {
	const runtime = createAuthRuntime(platform);
	const memberships = await listActiveHouseholdMemberships(platform, householdId);

	return Promise.all(
		memberships.map(async (membership) => {
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
