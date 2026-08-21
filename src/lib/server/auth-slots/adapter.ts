import { WorkOS } from '@workos-inc/node';
import type { AuthSlotId, AuthSlotStatus } from '$lib/auth-slots';

export interface AuthenticatedSlot {
	readonly authenticated: true;
	readonly sessionId: string;
	readonly user: SafeWorkOSUser;
	readonly organizationId: string | null;
}

export interface UnauthenticatedSlot {
	readonly authenticated: false;
	readonly reason: string;
}

export interface SafeWorkOSUser {
	readonly id: string;
	readonly email: string;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly profilePictureUrl: string | null;
}

export interface LiveWorkOSMembership {
	readonly membershipId: string;
	readonly householdId: string;
	readonly householdName: string;
	readonly roleSlug: string;
	readonly permissions: readonly string[];
}

export interface NewSlotSession extends AuthenticatedSlot {
	readonly sealedSession: string;
}

export interface AuthSlotAdapter {
	authorizationUrl(input: {
		readonly redirectUri: string;
		readonly state: string;
		readonly loginHint?: string;
	}): string;
	exchangeCode(input: {
		readonly code: string;
		readonly ipAddress?: string;
		readonly userAgent?: string;
	}): Promise<NewSlotSession>;
	authenticate(sealedSession: string): Promise<AuthenticatedSlot | UnauthenticatedSlot>;
	refresh(
		sealedSession: string,
		organizationId?: string
	): Promise<NewSlotSession | UnauthenticatedSlot>;
	revoke(sessionId: string): Promise<void>;
	listActiveOrganizationIds(userId: string): Promise<readonly string[]>;
	listActiveMemberships(userId: string): Promise<readonly LiveWorkOSMembership[]>;
}

export interface AuthSlotServerConfig {
	readonly apiKey: string;
	readonly clientId: string;
	readonly cookiePassword: string;
}

export function createWorkOSAuthSlotAdapter(config: AuthSlotServerConfig): AuthSlotAdapter {
	const workos = new WorkOS(config.apiKey, { clientId: config.clientId });

	return {
		authorizationUrl: ({ redirectUri, state, loginHint }) =>
			workos.userManagement.getAuthorizationUrl({
				provider: 'authkit',
				clientId: config.clientId,
				redirectUri,
				state,
				prompt: 'login',
				maxAge: 0,
				screenHint: 'sign-in',
				...(loginHint ? { loginHint } : {})
			}),

		async exchangeCode({ code, ipAddress, userAgent }) {
			const result = await workos.userManagement.authenticateWithCode({
				code,
				clientId: config.clientId,
				session: {
					sealSession: true,
					cookiePassword: config.cookiePassword
				},
				...(ipAddress ? { ipAddress } : {}),
				...(userAgent ? { userAgent } : {})
			});

			if (!result.sealedSession) throw new Error('WorkOS did not return a sealed session');
			return {
				authenticated: true,
				sealedSession: result.sealedSession,
				sessionId: readSessionId(result.accessToken),
				organizationId: result.organizationId ?? null,
				user: toSafeUser(result.user)
			};
		},

		async authenticate(sealedSession) {
			return normalizeAuthenticationResult(
				await workos.userManagement
					.loadSealedSession({
						sessionData: sealedSession,
						cookiePassword: config.cookiePassword
					})
					.authenticate()
			);
		},

		async refresh(sealedSession, organizationId) {
			const result = await workos.userManagement
				.loadSealedSession({
					sessionData: sealedSession,
					cookiePassword: config.cookiePassword
				})
				.refresh(organizationId ? { organizationId } : undefined);

			if (!result.authenticated) return result;
			if (!result.sealedSession)
				throw new Error('WorkOS did not return a refreshed sealed session');
			return {
				authenticated: true,
				sealedSession: result.sealedSession,
				sessionId: result.sessionId,
				organizationId: result.organizationId ?? null,
				user: toSafeUser(result.user)
			};
		},

		async revoke(sessionId) {
			await workos.userManagement.revokeSession({ sessionId });
		},

		async listActiveOrganizationIds(userId) {
			return (await this.listActiveMemberships(userId)).map(({ householdId }) => householdId);
		},

		async listActiveMemberships(userId) {
			const page = await workos.userManagement.listOrganizationMemberships({
				userId,
				statuses: ['active']
			});
			const memberships = await page.autoPagination();
			return Promise.all(
				memberships.map(async (membership) => {
					const role = await workos.authorization
						.getOrganizationRole(membership.organizationId, membership.role.slug)
						.catch(() => workos.authorization.getEnvironmentRole(membership.role.slug));
					return {
						membershipId: membership.id,
						householdId: membership.organizationId,
						householdName: membership.organizationName,
						roleSlug: membership.role.slug,
						permissions: role.permissions
					};
				})
			);
		}
	};
}

export function authStatusForReason(reason: string): AuthSlotStatus {
	return reason === 'invalid_grant' || reason === 'invalid_session_cookie'
		? 'reauthRequired'
		: 'stale';
}

function normalizeAuthenticationResult(
	result: Awaited<
		ReturnType<ReturnType<WorkOS['userManagement']['loadSealedSession']>['authenticate']>
	>
): AuthenticatedSlot | UnauthenticatedSlot {
	if (!result.authenticated) return result;
	return {
		authenticated: true,
		sessionId: result.sessionId,
		organizationId: result.organizationId ?? null,
		user: toSafeUser(result.user)
	};
}

function toSafeUser(user: {
	id: string;
	email: string;
	firstName: string | null;
	lastName: string | null;
	profilePictureUrl: string | null;
}): SafeWorkOSUser {
	return {
		id: user.id,
		email: user.email,
		firstName: user.firstName,
		lastName: user.lastName,
		profilePictureUrl: user.profilePictureUrl
	};
}

function readSessionId(accessToken: string) {
	const payload = accessToken.split('.')[1];
	if (!payload) throw new Error('WorkOS access token has no payload');

	const normalized = payload
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(payload.length / 4) * 4, '=');
	const claims = JSON.parse(atob(normalized)) as { sid?: unknown };
	if (typeof claims.sid !== 'string') throw new Error('WorkOS access token has no session ID');
	return claims.sid;
}

export function selectedSlotPath(slotId: AuthSlotId) {
	return `/api/auth-slots/${slotId}/`;
}
