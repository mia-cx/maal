import type { Cookies } from '@sveltejs/kit';
import { commitSealedSession, readSealedSession, type AuthUser } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';

export type PublicSettingsUser = Omit<AuthUser, 'metadata'>;

export const toPublicSettingsUser = (user: PublicSettingsUser): PublicSettingsUser => ({
	id: user.id,
	email: user.email,
	name: user.name,
	firstName: user.firstName,
	lastName: user.lastName,
	profilePictureUrl: user.profilePictureUrl,
	emailVerified: user.emailVerified
});

const isNullableString = (value: unknown): value is string | null =>
	typeof value === 'string' || value === null;

export const readPublicSettingsUser = (value: unknown): PublicSettingsUser => {
	if (!value || typeof value !== 'object') {
		throw new Error('WorkOS response did not include a user object.');
	}

	const user = value as Record<string, unknown>;
	if (
		typeof user.id !== 'string' ||
		typeof user.email !== 'string' ||
		!isNullableString(user.name) ||
		!isNullableString(user.firstName) ||
		!isNullableString(user.lastName) ||
		!isNullableString(user.profilePictureUrl) ||
		typeof user.emailVerified !== 'boolean'
	) {
		throw new Error('WorkOS response included an invalid user payload.');
	}

	return toPublicSettingsUser({
		id: user.id,
		email: user.email,
		name: user.name,
		firstName: user.firstName,
		lastName: user.lastName,
		profilePictureUrl: user.profilePictureUrl,
		emailVerified: user.emailVerified
	});
};

export const syncSessionUser = (sessionUser: AuthUser, user: PublicSettingsUser): AuthUser => ({
	...sessionUser,
	email: user.email,
	name: user.name,
	firstName: user.firstName,
	lastName: user.lastName,
	profilePictureUrl: user.profilePictureUrl,
	emailVerified: user.emailVerified
});

export const refreshSessionCookie = async (
	cookies: Cookies,
	platform: App.Platform | undefined,
	url: URL
): Promise<void> => {
	const sealedSession = readSealedSession(cookies);
	if (!sealedSession) return;

	const runtime = createAuthRuntime(platform);
	const cookieSession = runtime.workos.userManagement.loadSealedSession({
		sessionData: sealedSession,
		cookiePassword: runtime.cookiePassword
	});
	const refreshed = await cookieSession.refresh();
	if (!refreshed.authenticated || !refreshed.sealedSession) {
		throw new Error('WorkOS session refresh failed.');
	}

	commitSealedSession(cookies, refreshed.sealedSession, url);
};
