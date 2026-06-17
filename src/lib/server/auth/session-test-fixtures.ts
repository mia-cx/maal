import type { AuthSession } from './session';

export const createAuthSession = (overrides: Partial<AuthSession> = {}): AuthSession => ({
	user: {
		id: 'user_1',
		email: 'user@maal.test',
		name: null,
		firstName: null,
		lastName: null,
		profilePictureUrl: null,
		emailVerified: true,
		metadata: {}
	},
	sessionId: 'session_1',
	organizationId: null,
	role: null,
	roles: [],
	permissions: [],
	entitlements: [],
	featureFlags: [],
	...overrides
});
