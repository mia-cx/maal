import { env as privateEnv } from '$env/dynamic/private';
import type { AuthSession } from './session';

export const SMOKE_USER_ID = 'user_smoke_maal';
export const SMOKE_HOUSEHOLD_ID = 'org_smoke_kitchen';
export const SMOKE_HOUSEHOLD_NAME = 'Smoke Test Kitchen';

export const smokeAuthEnabled = (platform?: App.Platform): boolean =>
	(platform?.env.MAAL_SMOKE_AUTH_ENABLED ?? privateEnv.MAAL_SMOKE_AUTH_ENABLED) === 'true';

export const smokeSession = (): AuthSession => ({
	user: {
		id: SMOKE_USER_ID,
		email: 'smoke@maal.local',
		name: 'Smoke Tester',
		firstName: 'Smoke',
		lastName: 'Tester',
		profilePictureUrl: null,
		emailVerified: true
	},
	sessionId: 'sess_smoke_maal',
	organizationId: SMOKE_HOUSEHOLD_ID,
	role: 'admin',
	roles: ['admin'],
	permissions: ['household:manage'],
	entitlements: [],
	featureFlags: []
});
