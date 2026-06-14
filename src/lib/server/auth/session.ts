import type {
	AuthenticateWithSessionCookieSuccessResponse,
	RefreshSessionResponse,
	User
} from '@workos-inc/node';
import type { Cookies } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAME,
	CALLBACK_PATH,
	OAUTH_RETURN_TO_COOKIE_NAME,
	OAUTH_STATE_COOKIE_NAME,
	OAUTH_STATE_MAX_AGE_SECONDS,
	SESSION_MAX_AGE_SECONDS
} from './constants';
import type { AuthRuntime } from './workos';

export interface AuthUser {
	id: string;
	email: string;
	name: string | null;
	firstName: string | null;
	lastName: string | null;
	profilePictureUrl: string | null;
	emailVerified: boolean;
	metadata: Record<string, string>;
}

export interface AuthSession {
	user: AuthUser;
	sessionId: string;
	organizationId: string | null;
	role: string | null;
	roles: string[];
	permissions: string[];
	entitlements: string[];
	featureFlags: string[];
	accessToken?: string;
}

type PublicAuthUser = Omit<AuthUser, 'metadata'>;
export type PublicAuthSession = Omit<AuthSession, 'accessToken' | 'user'> & {
	user: PublicAuthUser;
};

type RefreshSessionSuccessResponse = Extract<RefreshSessionResponse, { authenticated: true }>;
type AuthenticatedSessionResponse =
	| AuthenticateWithSessionCookieSuccessResponse
	| RefreshSessionSuccessResponse;

const secureCookie = (url: URL): boolean => url.protocol === 'https:';

const privateCookieOptions = (maxAge: number, url: URL) => ({
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: secureCookie(url),
	maxAge
});

const toAuthUser = (user: User): AuthUser => ({
	id: user.id,
	email: user.email,
	name: user.name,
	firstName: user.firstName,
	lastName: user.lastName,
	profilePictureUrl: user.profilePictureUrl,
	emailVerified: user.emailVerified,
	metadata: user.metadata ?? {}
});

const accessTokenFrom = (response: AuthenticatedSessionResponse): string | undefined => {
	if ('accessToken' in response) return response.accessToken;
	return response.session?.accessToken;
};

export const toPublicSession = (session: AuthSession | null): PublicAuthSession | null => {
	if (!session) return null;

	const user: PublicAuthUser = {
		id: session.user.id,
		email: session.user.email,
		name: session.user.name,
		firstName: session.user.firstName,
		lastName: session.user.lastName,
		profilePictureUrl: session.user.profilePictureUrl,
		emailVerified: session.user.emailVerified
	};
	return {
		user,
		sessionId: session.sessionId,
		organizationId: session.organizationId,
		role: session.role,
		roles: session.roles,
		permissions: session.permissions,
		entitlements: session.entitlements,
		featureFlags: session.featureFlags
	};
};

export const createOAuthState = (): string => crypto.randomUUID();

export const readOAuthState = (cookies: Cookies): string | undefined =>
	cookies.get(OAUTH_STATE_COOKIE_NAME);

export const commitOAuthState = (cookies: Cookies, state: string, url: URL): void => {
	cookies.set(
		OAUTH_STATE_COOKIE_NAME,
		state,
		privateCookieOptions(OAUTH_STATE_MAX_AGE_SECONDS, url)
	);
};

export const clearOAuthState = (cookies: Cookies): void => {
	cookies.delete(OAUTH_STATE_COOKIE_NAME, { path: '/' });
};

export const commitOAuthReturnTo = (cookies: Cookies, returnTo: string, url: URL): void => {
	cookies.set(
		OAUTH_RETURN_TO_COOKIE_NAME,
		returnTo,
		privateCookieOptions(OAUTH_STATE_MAX_AGE_SECONDS, url)
	);
};

export const readOAuthReturnTo = (cookies: Cookies): string | undefined =>
	cookies.get(OAUTH_RETURN_TO_COOKIE_NAME);

export const clearOAuthReturnTo = (cookies: Cookies): void => {
	cookies.delete(OAUTH_RETURN_TO_COOKIE_NAME, { path: '/' });
};

export const readSealedSession = (cookies: Cookies): string | undefined =>
	cookies.get(AUTH_COOKIE_NAME);

export const commitSealedSession = (cookies: Cookies, sealedSession: string, url: URL): void => {
	cookies.set(AUTH_COOKIE_NAME, sealedSession, privateCookieOptions(SESSION_MAX_AGE_SECONDS, url));
};

export const clearSealedSession = (cookies: Cookies): void => {
	cookies.delete(AUTH_COOKIE_NAME, { path: '/' });
};

export const getRequestMetadata = (
	request: Request
): { ipAddress: string | undefined; userAgent: string | undefined } => ({
	ipAddress: request.headers.get('cf-connecting-ip') ?? undefined,
	userAgent: request.headers.get('user-agent') ?? undefined
});

export const getLoginUrl = (input: {
	runtime: AuthRuntime;
	origin: string;
	state: string;
	screenHint?: 'sign-in' | 'sign-up';
	organizationId?: string | null;
}): string =>
	input.runtime.workos.userManagement.getAuthorizationUrl({
		provider: 'authkit',
		clientId: input.runtime.clientId,
		redirectUri: `${input.origin}${CALLBACK_PATH}`,
		state: input.state,
		...(input.screenHint ? { screenHint: input.screenHint } : {}),
		...(input.organizationId ? { organizationId: input.organizationId } : {})
	});

export const authenticateSealedSession = async (input: {
	runtime: AuthRuntime;
	cookies: Cookies;
	url: URL;
}): Promise<AuthSession | null> => {
	const sealedSession = readSealedSession(input.cookies);
	if (!sealedSession) return null;

	try {
		const session = input.runtime.workos.userManagement.loadSealedSession({
			sessionData: sealedSession,
			cookiePassword: input.runtime.cookiePassword
		});

		const authenticated = await session.authenticate();
		if (authenticated.authenticated) return toAuthSession(authenticated);

		const refreshed = await session.refresh();
		if (refreshed.authenticated) {
			if (refreshed.sealedSession) {
				commitSealedSession(input.cookies, refreshed.sealedSession, input.url);
			}
			return toAuthSession(refreshed);
		}
	} catch {
		// Treat malformed or unsealable cookies as logged out at the request boundary.
	}

	clearSealedSession(input.cookies);
	return null;
};

export const getLogoutUrl = async (input: {
	runtime: AuthRuntime;
	cookies: Cookies;
	returnTo: string;
}): Promise<string | null> => {
	const sealedSession = readSealedSession(input.cookies);
	if (!sealedSession) return null;

	try {
		const session = input.runtime.workos.userManagement.loadSealedSession({
			sessionData: sealedSession,
			cookiePassword: input.runtime.cookiePassword
		});

		return await session.getLogoutUrl({ returnTo: input.returnTo });
	} catch {
		return null;
	}
};

export const toAuthSession = (response: AuthenticatedSessionResponse): AuthSession => ({
	user: toAuthUser(response.user),
	sessionId: response.sessionId,
	organizationId: response.organizationId ?? null,
	role: response.role ?? null,
	roles: response.roles ?? [],
	permissions: response.permissions ?? [],
	entitlements: response.entitlements ?? [],
	featureFlags: response.featureFlags ?? [],
	...(accessTokenFrom(response) ? { accessToken: accessTokenFrom(response) } : {})
});
