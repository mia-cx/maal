import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';

import {
	canManageActiveHousehold,
	clearHouseholdCookie,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { householdRoleSlug } from '$lib/server/auth/household-invites';

import { createAuthRuntime } from '$lib/server/auth/workos';
import { loadHouseholdView } from '$lib/server/household/household-view';
import { membershipHasAdminRole } from '$lib/server/household/members';
import { deleteHouseholdCascade } from '$lib/server/household/delete-household';
import { updateHouseholdAppliancesFromForm } from '$lib/server/household/appliance-settings';
import { updateHouseholdSettingsFromForm } from '$lib/server/household/settings-command';
import {
	createInviteFromForm,
	deleteInviteFromForm,
	revokeInviteFromForm,
	updateInviteRoleFromForm,
	type HouseholdInviteCommandResult
} from '$lib/server/household/invite-commands';
import { SMOKE_HOUSEHOLD_ID, smokeAuthEnabled } from '$lib/server/auth/smoke';
import { smokeHouseholdView } from '$lib/server/household/smoke-household-view';
import type { Actions, PageServerLoad } from './$types';

const requireLoadedHousehold = async ({ locals, parent }: Parameters<PageServerLoad>[0]) => {
	if (!locals.session) redirect(302, '/auth/login');
	const layout = await parent();
	if (!layout.activeHouseholdId) redirect(302, '/onboarding');
	return { session: locals.session, householdId: layout.activeHouseholdId };
};

const requireActionHousehold = async (event: {
	locals: App.Locals;
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
}) => {
	if (!event.locals.session) redirect(302, '/auth/login');
	const { householdId } = await resolveActiveHouseholdId({
		platform: event.platform,
		cookies: event.cookies,
		url: event.url,
		session: event.locals.session
	});
	if (!householdId) redirect(302, '/onboarding');
	return { session: event.locals.session, householdId };
};

const requireManageHousehold = async (event: {
	locals: App.Locals;
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
}) => {
	const household = await requireActionHousehold(event);
	if (!(await canManageActiveHousehold(event.platform, household.session, household.householdId))) {
		return fail(403, { message: 'You do not have permission to manage this household.' });
	}
	return household;
};

export const load: PageServerLoad = async (event) => {
	const { session, householdId } = await requireLoadedHousehold(event);

	if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
		return smokeHouseholdView(session.user.id);
	}

	if (!event.platform?.env.DB) redirect(302, '/onboarding');

	return loadHouseholdView({
		platform: event.platform,
		database: event.platform.env.DB,
		householdId,
		session,
		origin: event.url.origin
	});
};

const requireInviteStorage = (platform: App.Platform | undefined) => {
	const database = platform?.env.DB;
	return database ?? null;
};

const inviteCommandResponse = (result: HouseholdInviteCommandResult) =>
	result.ok ? { message: result.message } : fail(result.status, { message: result.message });

export const actions: Actions = {
	createInvite: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const database = requireInviteStorage(event.platform);
		if (!database) return fail(503, { message: 'Invite storage is not available.' });

		try {
			return inviteCommandResponse(
				await createInviteFromForm({
					database,
					householdId: managedHousehold.householdId,
					session: managedHousehold.session,
					form: await event.request.formData()
				})
			);
		} catch (cause) {
			console.error('Failed to create household invite', cause);
			return fail(500, { message: 'Could not create invite link.' });
		}
	},

	revokeInvite: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const database = requireInviteStorage(event.platform);
		if (!database) return fail(503, { message: 'Invite storage is not available.' });

		return inviteCommandResponse(
			await revokeInviteFromForm({
				database,
				householdId: managedHousehold.householdId,
				form: await event.request.formData()
			})
		);
	},

	deleteInvite: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const database = requireInviteStorage(event.platform);
		if (!database) return fail(503, { message: 'Invite storage is not available.' });

		return inviteCommandResponse(
			await deleteInviteFromForm({
				database,
				householdId: managedHousehold.householdId,
				form: await event.request.formData()
			})
		);
	},

	updateInviteRole: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const database = requireInviteStorage(event.platform);
		if (!database) return fail(503, { message: 'Invite storage is not available.' });

		return inviteCommandResponse(
			await updateInviteRoleFromForm({
				database,
				householdId: managedHousehold.householdId,
				form: await event.request.formData()
			})
		);
	},

	updateMemberRole: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId, session } = managedHousehold;
		const form = await event.request.formData();
		const membershipId = String(form.get('membershipId') ?? '').trim();
		const userId = String(form.get('userId') ?? '').trim();
		const roleSlug = householdRoleSlug(form.get('role'));
		if (!membershipId || !userId) return fail(400, { message: 'Choose a member to update.' });
		if (userId === session.user.id && roleSlug !== 'admin') {
			return fail(400, { message: 'You cannot remove your own manager access.' });
		}

		try {
			const runtime = createAuthRuntime(event.platform);
			const membership =
				await runtime.workos.userManagement.getOrganizationMembership(membershipId);
			if (membership.organizationId !== householdId || membership.userId !== userId) {
				return fail(404, { message: 'Household member not found.' });
			}
			if (membership.directoryManaged) {
				return fail(400, {
					message: 'Directory-managed member roles must be changed in the identity provider.'
				});
			}
			await runtime.workos.userManagement.updateOrganizationMembership(membershipId, { roleSlug });
			return { message: 'Member role updated.' };
		} catch (cause) {
			console.error('Failed to update household member role', cause);
			return fail(502, { message: 'Could not update member role.' });
		}
	},

	updateSettings: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });

		try {
			const result = await updateHouseholdSettingsFromForm({
				platform: event.platform,
				database: event.platform.env.DB,
				householdId: managedHousehold.householdId,
				form: await event.request.formData()
			});
			if (!result.ok) return fail(result.status, { message: result.message });
			return { message: result.message };
		} catch (cause) {
			console.error('Failed to update household settings', cause);
			return fail(502, { message: 'Could not update household settings.' });
		}
	},
	updateAppliances: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });

		try {
			const changedCount = await updateHouseholdAppliancesFromForm({
				database: event.platform.env.DB,
				householdId: managedHousehold.householdId,
				form: await event.request.formData()
			});
			return { message: changedCount > 0 ? 'Appliances saved.' : 'No changes.' };
		} catch (cause) {
			console.error('Failed to update household appliances', cause);
			return fail(502, { message: 'Could not update appliances.' });
		}
	},
	leaveHousehold: async (event) => {
		const household = await requireActionHousehold(event);
		const { session, householdId } = household;
		if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
			return fail(400, { message: 'Smoke household cannot be left.' });
		}

		try {
			const runtime = createAuthRuntime(event.platform);
			const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
				organizationId: householdId,
				statuses: ['active'],
				limit: 100
			});
			const currentMembership = memberships.data.find(
				(membership) => membership.userId === session.user.id
			);
			if (!currentMembership) return fail(404, { message: 'Household member not found.' });
			if (currentMembership.directoryManaged) {
				return fail(400, {
					message: 'Directory-managed members must leave through the identity provider.'
				});
			}

			const adminCount = memberships.data.filter(membershipHasAdminRole).length;
			if (membershipHasAdminRole(currentMembership) && adminCount <= 1) {
				return fail(400, {
					message: 'You are the last manager. Add another manager or delete the household instead.'
				});
			}

			await runtime.workos.userManagement.deleteOrganizationMembership(currentMembership.id);
			clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to leave household', cause);
			return fail(502, { message: 'Could not leave household.' });
		}

		redirect(303, '/onboarding');
	},

	removeMember: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { session, householdId } = managedHousehold;
		const form = await event.request.formData();
		const membershipId = String(form.get('membershipId') ?? '');
		const userId = String(form.get('userId') ?? '');
		if (!membershipId || !userId) return fail(400, { message: 'Choose a member to remove.' });
		if (userId === session.user.id) return fail(400, { message: 'You cannot remove yourself.' });

		try {
			const runtime = createAuthRuntime(event.platform);
			const membership =
				await runtime.workos.userManagement.getOrganizationMembership(membershipId);
			if (membership.organizationId !== householdId || membership.userId !== userId) {
				return fail(404, { message: 'Household member not found.' });
			}
			if (membership.directoryManaged) {
				return fail(400, {
					message: 'Directory-managed members must be removed in the identity provider.'
				});
			}
			await runtime.workos.userManagement.deleteOrganizationMembership(membershipId);
			return { message: 'Member removed.' };
		} catch (cause) {
			console.error('Failed to remove household member', cause);
			return fail(502, { message: 'Could not remove member.' });
		}
	},
	deleteHousehold: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId } = managedHousehold;
		if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
			return fail(400, { message: 'Smoke household cannot be deleted.' });
		}
		if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });

		try {
			await deleteHouseholdCascade({
				database: event.platform.env.DB,
				platform: event.platform,
				householdId
			});
			clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to delete household', cause);
			return fail(502, { message: 'Could not delete household.' });
		}

		redirect(303, '/onboarding');
	}
};
