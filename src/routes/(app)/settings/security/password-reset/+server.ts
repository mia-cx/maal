import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createAuthRuntime } from '$lib/server/auth/workos';

export const POST: RequestHandler = async ({ locals, platform }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	try {
		const passwordReset = await createAuthRuntime(
			platform
		).workos.userManagement.createPasswordReset({
			email: session.user.email
		});

		return json({ passwordResetUrl: passwordReset.passwordResetUrl });
	} catch (cause) {
		console.error('Failed to create WorkOS password reset', cause);
		error(502, { message: 'Could not start password reset.' });
	}
};
