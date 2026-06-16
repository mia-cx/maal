import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import { readJsonObject } from '$lib/server/http/request';
import { isVerificationCode, normalizeVerificationCode } from '$lib/settings/verification-code';
import {
	refreshSessionCookie,
	syncSessionUser,
	toPublicSettingsUser
} from '$lib/server/settings/account-session';
import {
	confirmWorkosEmailChangeCode,
	isInvalidEmailChangeCode,
	sendWorkosEmailChangeCode
} from '$lib/server/settings/workos-email-change';

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
	const code = normalizeVerificationCode(body.code);
	if (!isVerificationCode(code)) error(400, { message: 'Enter the 6-digit verification code.' });
	return code;
};

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const email = emailFromBody(await readJsonObject(request));

	try {
		await sendWorkosEmailChangeCode(platform, session.user.id, email);
		return json({ ok: true, email });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
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
		const user = await confirmWorkosEmailChangeCode(platform, session.user.id, code);
		session.user = syncSessionUser(session.user, user);
		await refreshSessionCookie(cookies, platform, url);

		return json({ user: toPublicSettingsUser(user) });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		if (isInvalidEmailChangeCode(cause)) {
			error(400, { message: 'Could not verify that code.' });
		}
		console.error('Failed to confirm WorkOS email change', cause);
		error(502, { message: 'Could not verify that code.' });
	}
};
