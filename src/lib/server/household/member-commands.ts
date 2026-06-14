import { householdRoleSlug } from '$lib/server/auth/household-invites';
import type { AuthSession } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { membershipHasAdminRole } from '$lib/server/household/members';

export type HouseholdMemberCommandResult =
	| { ok: true; message: string; clearHousehold?: boolean }
	| { ok: false; status: number; message: string };

export const updateMemberRoleFromForm = async ({
	platform,
	householdId,
	session,
	form
}: {
	platform: App.Platform | undefined;
	householdId: string;
	session: AuthSession;
	form: FormData;
}): Promise<HouseholdMemberCommandResult> => {
	const membershipId = String(form.get('membershipId') ?? '').trim();
	const userId = String(form.get('userId') ?? '').trim();
	const roleSlug = householdRoleSlug(form.get('role'));
	if (!membershipId || !userId)
		return { ok: false, status: 400, message: 'Choose a member to update.' };
	if (userId === session.user.id && roleSlug !== 'admin') {
		return { ok: false, status: 400, message: 'You cannot remove your own manager access.' };
	}

	const runtime = createAuthRuntime(platform);
	const membership = await runtime.workos.userManagement.getOrganizationMembership(membershipId);
	if (membership.organizationId !== householdId || membership.userId !== userId) {
		return { ok: false, status: 404, message: 'Household member not found.' };
	}
	if (membership.directoryManaged) {
		return {
			ok: false,
			status: 400,
			message: 'Directory-managed member roles must be changed in the identity provider.'
		};
	}
	await runtime.workos.userManagement.updateOrganizationMembership(membershipId, { roleSlug });
	return { ok: true, message: 'Member role updated.' };
};

export const leaveHouseholdMembership = async ({
	platform,
	householdId,
	session
}: {
	platform: App.Platform | undefined;
	householdId: string;
	session: AuthSession;
}): Promise<HouseholdMemberCommandResult> => {
	const runtime = createAuthRuntime(platform);
	const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
		organizationId: householdId,
		statuses: ['active'],
		limit: 100
	});
	const currentMembership = memberships.data.find(
		(membership) => membership.userId === session.user.id
	);
	if (!currentMembership) return { ok: false, status: 404, message: 'Household member not found.' };
	if (currentMembership.directoryManaged) {
		return {
			ok: false,
			status: 400,
			message: 'Directory-managed members must leave through the identity provider.'
		};
	}

	const adminCount = memberships.data.filter(membershipHasAdminRole).length;
	if (membershipHasAdminRole(currentMembership) && adminCount <= 1) {
		return {
			ok: false,
			status: 400,
			message: 'You are the last manager. Add another manager or delete the household instead.'
		};
	}

	await runtime.workos.userManagement.deleteOrganizationMembership(currentMembership.id);
	return { ok: true, message: 'Household left.', clearHousehold: true };
};

export const removeMemberFromForm = async ({
	platform,
	householdId,
	session,
	form
}: {
	platform: App.Platform | undefined;
	householdId: string;
	session: AuthSession;
	form: FormData;
}): Promise<HouseholdMemberCommandResult> => {
	const membershipId = String(form.get('membershipId') ?? '');
	const userId = String(form.get('userId') ?? '');
	if (!membershipId || !userId)
		return { ok: false, status: 400, message: 'Choose a member to remove.' };
	if (userId === session.user.id)
		return { ok: false, status: 400, message: 'You cannot remove yourself.' };

	const runtime = createAuthRuntime(platform);
	const membership = await runtime.workos.userManagement.getOrganizationMembership(membershipId);
	if (membership.organizationId !== householdId || membership.userId !== userId) {
		return { ok: false, status: 404, message: 'Household member not found.' };
	}
	if (membership.directoryManaged) {
		return {
			ok: false,
			status: 400,
			message: 'Directory-managed members must be removed in the identity provider.'
		};
	}
	await runtime.workos.userManagement.deleteOrganizationMembership(membershipId);
	return { ok: true, message: 'Member removed.' };
};
