import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createAuthRuntime } from '$lib/server/auth/workos';

export const POST: RequestHandler = async ({ locals, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: m.app_sign_in_required() });

	try {
		const passwordReset = await createAuthRuntime(
			platform
		).workos.userManagement.createPasswordReset({
			email: session.user.email
		});

		return json({ passwordResetUrl: passwordReset.passwordResetUrl });
	} catch (cause) {
		console.error('Failed to create WorkOS password reset', cause);
		error(502, { message: m.settings_could_not_start_password_reset() });
	}
};
