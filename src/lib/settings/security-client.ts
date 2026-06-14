import { resolve } from '$app/paths';
import { readSettingsError } from '$lib/settings/api-client';
import type { MfaFactor } from '$lib/settings/types';

export type MfaSetupResponse = {
	factorId: string;
	challengeId: string;
	qrCode: string;
	secret: string;
};

export const loadMfaFactors = async (): Promise<
	{ ok: true; factors: MfaFactor[] } | { ok: false; error: string }
> => {
	const response = await fetch(resolve('/settings/security/mfa'));
	if (!response.ok) {
		return {
			ok: false,
			error: await readSettingsError(response, 'Could not load two-factor methods.')
		};
	}
	return { ok: true, ...((await response.json()) as { factors: MfaFactor[] }) };
};

export const startMfaSetupRequest = async (): Promise<
	{ ok: true; setup: MfaSetupResponse } | { ok: false; error: string }
> => {
	const response = await fetch(resolve('/settings/security/mfa'), { method: 'POST' });
	if (!response.ok) {
		return {
			ok: false,
			error: await readSettingsError(response, 'Could not start two-factor setup.')
		};
	}
	return { ok: true, setup: (await response.json()) as MfaSetupResponse };
};

export const verifyMfaSetupRequest = async ({
	factorId,
	challengeId,
	code
}: {
	factorId: string;
	challengeId: string;
	code: string;
}): Promise<{ ok: true; factors?: MfaFactor[] } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/security/mfa'), {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ factorId, challengeId, code })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'That code did not match.') };
	}
	return { ok: true, ...((await response.json()) as { factors?: MfaFactor[] }) };
};

export const deleteMfaFactorRequest = async (
	factorId: string
): Promise<{ ok: true; factors: MfaFactor[] } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/security/mfa'), {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ factorId })
	});
	if (!response.ok) {
		return {
			ok: false,
			error: await readSettingsError(response, 'Could not remove two-factor method.')
		};
	}
	return { ok: true, ...((await response.json()) as { factors: MfaFactor[] }) };
};

export const changePasswordRequest = async ({
	currentPassword,
	newPassword
}: {
	currentPassword: string;
	newPassword: string;
}): Promise<{ ok: true } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/settings/security/password'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ currentPassword, newPassword })
	});
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not change password.') };
	}
	return { ok: true };
};
