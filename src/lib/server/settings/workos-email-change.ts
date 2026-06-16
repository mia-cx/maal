import { createAuthRuntime } from '$lib/server/auth/workos';
import { readPublicSettingsUser } from '$lib/server/settings/account-session';

const emailChangeUrl = (userId: string, action: 'send' | 'confirm'): string =>
	`https://api.workos.com/user_management/users/${encodeURIComponent(userId)}/email_change/${action}`;

export const sendWorkosEmailChangeCode = async (
	platform: App.Platform | undefined,
	userId: string,
	email: string
): Promise<void> => {
	const runtime = createAuthRuntime(platform);
	const response = await fetch(emailChangeUrl(userId, 'send'), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${runtime.apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ new_email: email })
	});

	if (!response.ok) throw new Error(`send email change failed: ${response.status}`);
};

export const confirmWorkosEmailChangeCode = async (
	platform: App.Platform | undefined,
	userId: string,
	code: string
) => {
	const runtime = createAuthRuntime(platform);
	const response = await fetch(emailChangeUrl(userId, 'confirm'), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${runtime.apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ code })
	});

	if (!response.ok) throw new Error(`confirm email change failed: ${response.status}`);
	const payload = (await response.json()) as { user?: unknown };
	return readPublicSettingsUser(payload.user);
};
