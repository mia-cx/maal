import * as m from '$lib/paraglide/messages';
import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import { getRequestMetadata } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { readJsonObject } from '$lib/server/http/request';

const minPasswordLength = 8;
const maxPasswordLength = 72;

const textField = (body: Record<string, unknown>, key: string): string => {
	const value = body[key];
	return typeof value === 'string' ? value : '';
};

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: m.app_sign_in_required() });

	const body = await readJsonObject(request);
	const currentPassword = textField(body, 'currentPassword');
	const newPassword = textField(body, 'newPassword');

	if (!currentPassword) error(400, { message: m.settings_current_password_is_required() });
	if (newPassword.length < minPasswordLength) {
		error(400, { message: m.settings_password_min_length({ min: minPasswordLength }) });
	}
	if (newPassword.length > maxPasswordLength) {
		error(400, { message: m.settings_password_max_length({ max: maxPasswordLength }) });
	}
	if (currentPassword === newPassword)
		error(400, { message: m.settings_choose_a_different_password() });

	try {
		const runtime = createAuthRuntime(platform);
		const metadata = getRequestMetadata(request);
		const authenticated = await runtime.workos.userManagement.authenticateWithPassword({
			clientId: runtime.clientId,
			email: session.user.email,
			password: currentPassword,
			...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
			...(metadata.userAgent ? { userAgent: metadata.userAgent } : {})
		});

		if (authenticated.user.id !== session.user.id) {
			error(403, { message: m.settings_current_password_did_not_match_this_account() });
		}

		await runtime.workos.userManagement.updateUser({
			userId: session.user.id,
			password: newPassword
		});

		return json({ ok: true });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to change WorkOS password', cause);
		error(400, { message: m.settings_could_not_change_password_check_your_current() });
	}
};
