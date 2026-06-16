import { error, json, type RequestHandler } from '@sveltejs/kit';
import { commitSealedSession, readSealedSession } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { readJsonObject } from '$lib/server/http/request';

const maxNameLength = 100;
const maxEmailLength = 254;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const textField = (body: Record<string, unknown>, key: string): string => {
	const value = body[key];
	return typeof value === 'string' ? value.trim() : '';
};

const refreshSessionCookie = async (
	cookies: Parameters<typeof readSealedSession>[0],
	platform: App.Platform | undefined,
	url: URL
) => {
	const sealedSession = readSealedSession(cookies);
	if (!sealedSession) return;

	const runtime = createAuthRuntime(platform);
	const cookieSession = runtime.workos.userManagement.loadSealedSession({
		sessionData: sealedSession,
		cookiePassword: runtime.cookiePassword
	});
	const refreshed = await cookieSession.refresh();
	if (refreshed.authenticated && refreshed.sealedSession) {
		commitSealedSession(cookies, refreshed.sealedSession, url);
	}
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
		const updatedUser = await runtime.workos.userManagement.updateUser({
			userId: session.user.id,
			name
		});

		if (email !== currentEmail) {
			const response = await fetch(
				`https://api.workos.com/user_management/users/${session.user.id}/email_change/send`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${runtime.apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ new_email: email })
				}
			);

			if (!response.ok) throw new Error(`send email change failed: ${response.status}`);

			session.user = {
				...session.user,
				name: updatedUser.name,
				firstName: updatedUser.firstName,
				lastName: updatedUser.lastName,
				profilePictureUrl: updatedUser.profilePictureUrl
			};

			return json({
				pendingEmail: email,
				user: {
					id: updatedUser.id,
					email: session.user.email,
					name: updatedUser.name,
					firstName: updatedUser.firstName,
					lastName: updatedUser.lastName,
					profilePictureUrl: updatedUser.profilePictureUrl,
					emailVerified: session.user.emailVerified
				}
			});
		}

		session.user = {
			...session.user,
			name: updatedUser.name,
			firstName: updatedUser.firstName,
			lastName: updatedUser.lastName,
			profilePictureUrl: updatedUser.profilePictureUrl,
			email: updatedUser.email,
			emailVerified: updatedUser.emailVerified
		};

		try {
			await refreshSessionCookie(cookies, platform, url);
		} catch {
			// The API response still carries the updated profile for the current UI.
		}

		return json({
			user: {
				id: updatedUser.id,
				email: updatedUser.email,
				name: updatedUser.name,
				firstName: updatedUser.firstName,
				lastName: updatedUser.lastName,
				profilePictureUrl: updatedUser.profilePictureUrl,
				emailVerified: updatedUser.emailVerified
			}
		});
	} catch (cause) {
		console.error('Failed to update WorkOS user', cause);
		error(502, { message: 'Could not update account.' });
	}
};
