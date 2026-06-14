import { resolve } from '$app/paths';
import { readSettingsError } from '$lib/settings/api-client';
import type { UpdatedUser } from '$lib/settings/types';

export const saveAccountSettings = async ({
	name,
	email
}: {
	name: string;
	email: string;
}): Promise<
	{ ok: true; user: UpdatedUser; pendingEmail?: string } | { ok: false; error: string }
> => {
	const response = await fetch(resolve('/settings/account'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name, email })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not update account.') };
	}
	return { ok: true, ...((await response.json()) as { user: UpdatedUser; pendingEmail?: string }) };
};

export const sendAccountVerificationEmail = async (
	email: string
): Promise<{ ok: true } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/account/email-verification'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email })
	});
	if (!response.ok) {
		return {
			ok: false,
			error: await readSettingsError(response, 'Could not send verification email.')
		};
	}
	return { ok: true };
};

export const verifyAccountEmailCode = async ({
	email,
	code
}: {
	email: string;
	code: string;
}): Promise<{ ok: true; user: UpdatedUser } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/account/email-verification'), {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, code })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'That code did not match.') };
	}
	return { ok: true, ...((await response.json()) as { user: UpdatedUser }) };
};
