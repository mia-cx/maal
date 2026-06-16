import type { AuthSession } from '$lib/server/auth/session';
import {
	createHouseholdInvite,
	deleteHouseholdInvite,
	householdRoleSlug,
	revokeHouseholdInvite,
	updateHouseholdInviteRole
} from '$lib/server/auth/household-invites';
import { optionalIntegerFromForm, stringFromForm } from '$lib/domain/household/form-parsing';
import { inviteExpiryDays, inviteExpiryFromDays } from '$lib/domain/household/settings-parsing';

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
	const maxUses = optionalIntegerFromForm({
		value: form.get('maxUses'),
		message: 'Max uses must be a whole number from 1 to 100.',
		min: 1,
		max: 100
	});
	if (!maxUses.ok) return { ok: false, status: 400, message: maxUses.message };
	const expiresInDays = optionalIntegerFromForm({
		value: form.get('expiresInDays'),
		message: 'Invite expiry must be 1, 7, or 30 days.'
	});
	if (!expiresInDays.ok) return { ok: false, status: 400, message: expiresInDays.message };
	const safeExpiryDays = expiresInDays.value ?? 7;
	if (!inviteExpiryDays.includes(safeExpiryDays as (typeof inviteExpiryDays)[number])) {
		return { ok: false, status: 400, message: 'Invite expiry must be 1, 7, or 30 days.' };
	}
	const expiresAt = inviteExpiryFromDays(safeExpiryDays as (typeof inviteExpiryDays)[number]);

	await createHouseholdInvite({
		database,
		householdId,
		createdByUserId: session.user.id,
		roleSlug,
		maxUses: maxUses.value,
		expiresAt
	});
	return { ok: true, message: 'Invite link created.' };
};

const inviteIdFromForm = (
	form: FormData,
	missingMessage: string
): { ok: true; inviteId: string } | { ok: false; status: number; message: string } => {
	const parsed = stringFromForm(form.get('inviteId'), missingMessage);
	if (!parsed.ok || !parsed.value) return { ok: false, status: 400, message: missingMessage };
	return { ok: true, inviteId: parsed.value };
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
