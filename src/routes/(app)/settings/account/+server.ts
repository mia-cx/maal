import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { readJsonObject } from '$lib/server/http/request';
import {
	refreshSessionCookie,
	syncSessionUser,
	toPublicSettingsUser
} from '$lib/server/settings/account-session';
import { sendWorkosEmailChangeCode } from '$lib/server/settings/workos-email-change';

const maxNameLength = 100;
const maxEmailLength = 254;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const textField = (body: Record<string, unknown>, key: string): string => {
	const value = body[key];
	return typeof value === 'string' ? value.trim() : '';
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const body = await readJsonObject(request);
	const name = textField(body, 'name');
	const email = textField(body, 'email').toLowerCase();

	if (!name) error(400, { message: 'Name is required.' });
	if (name.length > maxNameLength) error(400, { message: 'Name is too long.' });
	if (!emailPattern.test(email) || email.length > maxEmailLength) {
		error(400, { message: 'Enter a valid email address.' });
	}

	try {
		const runtime = createAuthRuntime(platform);
		const currentEmail = session.user.email.toLowerCase();

		if (email !== currentEmail) {
			await sendWorkosEmailChangeCode(platform, session.user.id, email);
		}

		const updatedUser = await runtime.workos.userManagement.updateUser({
			userId: session.user.id,
			name
		});

		const publicUser = toPublicSettingsUser({
			id: updatedUser.id,
			email: email === currentEmail ? updatedUser.email : session.user.email,
			name: updatedUser.name,
			firstName: updatedUser.firstName,
			lastName: updatedUser.lastName,
			profilePictureUrl: updatedUser.profilePictureUrl,
			emailVerified: email === currentEmail ? updatedUser.emailVerified : session.user.emailVerified
		});
		session.user = syncSessionUser(session.user, publicUser);

		if (email === currentEmail) await refreshSessionCookie(cookies, platform, url);

		return json({
			...(email !== currentEmail ? { pendingEmail: email } : {}),
			user: publicUser
		});
	} catch (cause) {
		console.error('Failed to update WorkOS user', cause);
		error(502, { message: 'Could not update account.' });
	}
};
