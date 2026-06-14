import { error } from '@sveltejs/kit';
import type { AuthSession } from '$lib/server/auth/session';
import { hasHouseholdAccess } from './entitlements';

export const requireHouseholdAccess = async (input: {
	platform?: App.Platform;
	database: D1Database;
	session: AuthSession;
	householdId: string;
}): Promise<void> => {
	if (await hasHouseholdAccess(input)) return;
	error(402, { message: 'An active Maal plan is required for this household.' });
};
