import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getRequestMetadata } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';

const minPasswordLength = 8;
const maxPasswordLength = 72;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const requestBody = async (request: Request): Promise<Record<string, unknown>> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}

	if (!isRecord(body)) error(400, { message: 'Invalid request.' });
	return body;
};

const textField = (body: Record<string, unknown>, key: string): string => {
	const value = body[key];
	return typeof value === 'string' ? value : '';
};

export const POST: RequestHandler = async ({ locals, platform, request }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const body = await requestBody(request);
	const currentPassword = textField(body, 'currentPassword');
	const newPassword = textField(body, 'newPassword');

	if (!currentPassword) error(400, { message: 'Current password is required.' });
	if (newPassword.length < minPasswordLength) {
		error(400, { message: `Use at least ${minPasswordLength} characters.` });
	}
	if (newPassword.length > maxPasswordLength) {
		error(400, { message: `Use ${maxPasswordLength} characters or fewer.` });
	}
	if (currentPassword === newPassword) error(400, { message: 'Choose a different password.' });

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
			error(403, { message: 'Current password did not match this account.' });
		}

		await runtime.workos.userManagement.updateUser({
			userId: session.user.id,
			password: newPassword
		});

		return json({ ok: true });
	} catch (cause) {
		console.error('Failed to change WorkOS password', cause);
		error(400, { message: 'Could not change password. Check your current password.' });
	}
};
