import { error, json, type RequestHandler } from '@sveltejs/kit';
import { commitSealedSession, readSealedSession } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { readJsonObject } from '$lib/server/http/request';

const maxEmailLength = 254;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailFromBody = (body: Record<string, unknown>): string => {
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (!emailPattern.test(email) || email.length > maxEmailLength) {
		error(400, { message: 'Enter a valid email address.' });
	}
	return email;
};

const codeFromBody = (body: Record<string, unknown>): string => {
	const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
	if (code.length < 6) error(400, { message: 'Verification code is required.' });
	return code;
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

const userPayload = (user: {
	id: string;
	email: string;
	name: string | null;
	firstName: string | null;
	lastName: string | null;
	profilePictureUrl: string | null;
	emailVerified: boolean;
}) => ({
	id: user.id,
	email: user.email,
	name: user.name,
	firstName: user.firstName,
	lastName: user.lastName,
	profilePictureUrl: user.profilePictureUrl,
	emailVerified: user.emailVerified
});

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const email = emailFromBody(await readJsonObject(request));

	try {
		const runtime = createAuthRuntime(platform);
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

		return json({ ok: true, email });
	} catch (cause) {
		console.error('Failed to send WorkOS email change code', cause);
		error(502, { message: 'Could not send verification email.' });
	}
};

export const PUT: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const body = await readJsonObject(request);
	const code = codeFromBody(body);

	try {
		const runtime = createAuthRuntime(platform);
		const response = await fetch(
			`https://api.workos.com/user_management/users/${session.user.id}/email_change/confirm`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${runtime.apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ code })
			}
		);

		if (!response.ok) throw new Error(`confirm email change failed: ${response.status}`);

		const payload = (await response.json()) as { user?: typeof session.user };
		const user = payload.user;
		if (!user) throw new Error('WorkOS email change response did not include a user.');

		session.user = {
			...session.user,
			email: user.email,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
			profilePictureUrl: user.profilePictureUrl,
			emailVerified: user.emailVerified
		};

		try {
			await refreshSessionCookie(cookies, platform, url);
		} catch {
			// The response still updates the current UI if the cookie refresh fails.
		}

		return json({ user: userPayload(user) });
	} catch (cause) {
		console.error('Failed to confirm WorkOS email change', cause);
		error(400, { message: 'Could not verify that code.' });
	}
};
