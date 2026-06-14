import type { AuthSession } from '$lib/server/auth/session';
import {
	createHouseholdInvite,
	deleteHouseholdInvite,
	householdRoleSlug,
	revokeHouseholdInvite,
	updateHouseholdInviteRole
} from '$lib/server/auth/household-invites';
import { inviteExpiryFromForm } from '$lib/domain/household/settings-parsing';

export type HouseholdInviteCommandResult =
	| { ok: true; message: string }
	| { ok: false; status: number; message: string };

export const createInviteFromForm = async ({
	database,
	householdId,
	session,
	form
}: {
	database: D1Database;
	householdId: string;
	session: AuthSession;
	form: FormData;
}): Promise<HouseholdInviteCommandResult> => {
	const roleSlug = householdRoleSlug(form.get('role'));
	const maxUsesRaw = String(form.get('maxUses') ?? '').trim();
	const maxUses = maxUsesRaw ? Math.max(1, Math.min(100, Number.parseInt(maxUsesRaw, 10))) : null;
	const expiresAt = inviteExpiryFromForm(form.get('expiresInDays'));
	if (maxUsesRaw && !Number.isFinite(maxUses)) {
		return { ok: false, status: 400, message: 'Max uses must be a number.' };
	}

	await createHouseholdInvite({
		database,
		householdId,
		createdByUserId: session.user.id,
		roleSlug,
		maxUses,
		expiresAt
	});
	return { ok: true, message: 'Invite link created.' };
};

const inviteIdFromForm = (
	form: FormData,
	missingMessage: string
): { ok: true; inviteId: string } | { ok: false; status: number; message: string } => {
	const inviteId = String(form.get('inviteId') ?? '').trim();
	return inviteId ? { ok: true, inviteId } : { ok: false, status: 400, message: missingMessage };
};

export const revokeInviteFromForm = async ({
	database,
	householdId,
	form
}: {
	database: D1Database;
	householdId: string;
	form: FormData;
}): Promise<HouseholdInviteCommandResult> => {
	const parsed = inviteIdFromForm(form, 'Choose an invite to revoke.');
	if (!parsed.ok) return parsed;
	await revokeHouseholdInvite({ database, householdId, inviteId: parsed.inviteId });
	return { ok: true, message: 'Invite revoked.' };
};

export const deleteInviteFromForm = async ({
	database,
	householdId,
	form
}: {
	database: D1Database;
	householdId: string;
	form: FormData;
}): Promise<HouseholdInviteCommandResult> => {
	const parsed = inviteIdFromForm(form, 'Choose an invite to delete.');
	if (!parsed.ok) return parsed;
	await deleteHouseholdInvite({ database, householdId, inviteId: parsed.inviteId });
	return { ok: true, message: 'Invite deleted.' };
};

export const updateInviteRoleFromForm = async ({
	database,
	householdId,
	form
}: {
	database: D1Database;
	householdId: string;
	form: FormData;
}): Promise<HouseholdInviteCommandResult> => {
	const parsed = inviteIdFromForm(form, 'Choose an invite to update.');
	if (!parsed.ok) return parsed;
	await updateHouseholdInviteRole({
		database,
		householdId,
		inviteId: parsed.inviteId,
		roleSlug: householdRoleSlug(form.get('role'))
	});
	return { ok: true, message: 'Invite role updated.' };
};
