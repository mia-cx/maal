import { createAuthRuntime } from '$lib/server/auth/workos';
import { readPublicSettingsUser } from '$lib/server/settings/account-session';

const workosRequestTimeoutMs = 10_000;

export class WorkosEmailChangeError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'WorkosEmailChangeError';
	}
}

export const isInvalidEmailChangeCode = (cause: unknown): boolean =>
	cause instanceof WorkosEmailChangeError && [400, 404, 422].includes(cause.status);

const emailChangeUrl = (userId: string, action: 'send' | 'confirm'): string =>
	`https://api.workos.com/user_management/users/${encodeURIComponent(userId)}/email_change/${action}`;

const fetchWorkos = (input: RequestInfo | URL, init: RequestInit): Promise<Response> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), workosRequestTimeoutMs);
	return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
};

export const sendWorkosEmailChangeCode = async (
	platform: App.Platform | undefined,
	userId: string,
	email: string
): Promise<void> => {
	const runtime = createAuthRuntime(platform);
	const response = await fetchWorkos(emailChangeUrl(userId, 'send'), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${runtime.apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ new_email: email })
	});

	if (!response.ok) throw new WorkosEmailChangeError('send email change failed', response.status);
};

export const confirmWorkosEmailChangeCode = async (
	platform: App.Platform | undefined,
	userId: string,
	code: string
) => {
	const runtime = createAuthRuntime(platform);
	const response = await fetchWorkos(emailChangeUrl(userId, 'confirm'), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${runtime.apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ code })
	});

	if (!response.ok)
		throw new WorkosEmailChangeError('confirm email change failed', response.status);
	const payload = (await response.json()) as { user?: unknown };
	return readPublicSettingsUser(payload.user);
};
