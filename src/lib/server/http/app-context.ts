import { error, type Cookies } from '@sveltejs/kit';
import type { AuthSession } from '$lib/server/auth/session';
import { resolveActiveHouseholdId } from '$lib/server/auth/household';
import { requireHouseholdAccess } from '$lib/server/domains/billing';
import { getDb } from '$lib/server/db';

export type AuthenticatedAppContext = {
	session: AuthSession;
	householdId: string;
	database: D1Database;
	db: ReturnType<typeof getDb>;
};

export const requireAppContext = async (input: {
	cookies: Cookies;
	locals: App.Locals;
	platform: App.Platform | undefined;
	url: URL;
}): Promise<AuthenticatedAppContext> => {
	const session = input.locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const database = input.platform?.env.DB;
	if (!database) error(503, { message: 'Database unavailable.' });

	const { householdId } = await resolveActiveHouseholdId({
		platform: input.platform,
		cookies: input.cookies,
		url: input.url,
		session
	});
	if (!householdId) error(400, { message: 'Household is required.' });

	await requireHouseholdAccess({
		platform: input.platform,
		householdId
	});

	return { session, householdId, database, db: getDb(database) };
};
