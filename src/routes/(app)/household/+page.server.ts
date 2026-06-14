import { fail, redirect } from '@sveltejs/kit';
import { clearHouseholdCookie } from '$lib/server/auth/household';
import { loadHouseholdView } from '$lib/server/household/household-view';
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
import {
	leaveHouseholdMembership,
	removeMemberFromForm,
	updateMemberRoleFromForm,
	type HouseholdMemberCommandResult
} from '$lib/server/household/member-commands';
import { SMOKE_HOUSEHOLD_ID, smokeAuthEnabled } from '$lib/server/auth/smoke';
import { smokeHouseholdView } from '$lib/server/household/smoke-household-view';
import {
	requireActionHousehold,
	requireManageHousehold
} from '$lib/server/household/action-context';
import { requireLoadedHousehold } from '$lib/server/household/load-context';
import type { Actions, PageServerLoad } from './$types';

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

const memberCommandResponse = (result: HouseholdMemberCommandResult) =>
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

		try {
			return memberCommandResponse(
				await updateMemberRoleFromForm({
					platform: event.platform,
					householdId: managedHousehold.householdId,
					session: managedHousehold.session,
					form: await event.request.formData()
				})
			);
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
			const result = await leaveHouseholdMembership({
				platform: event.platform,
				householdId,
				session
			});
			if (!result.ok) return fail(result.status, { message: result.message });
			if (result.clearHousehold) clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to leave household', cause);
			return fail(502, { message: 'Could not leave household.' });
		}

		redirect(303, '/onboarding');
	},
	removeMember: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;

		try {
			return memberCommandResponse(
				await removeMemberFromForm({
					platform: event.platform,
					householdId: managedHousehold.householdId,
					session: managedHousehold.session,
					form: await event.request.formData()
				})
			);
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
