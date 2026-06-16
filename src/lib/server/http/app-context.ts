import { error, isHttpError, type Cookies } from '@sveltejs/kit';
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

export type AppContextInput = {
	cookies: Cookies;
	locals: App.Locals;
	platform: App.Platform | undefined;
	url: URL;
};

export const requireAppContext = async (
	input: AppContextInput
): Promise<AuthenticatedAppContext> => {
	const session = input.locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	const database = input.platform?.env.DB;
	if (!database) error(503, { message: 'Database unavailable.' });

	let householdId: string | null;
	let hasAnyHousehold: boolean;
	try {
		({ householdId, hasAnyHousehold } = await resolveActiveHouseholdId({
			platform: input.platform,
			cookies: input.cookies,
			url: input.url,
			session
		}));
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to resolve active household', cause);
		error(503, { message: 'Household service unavailable.' });
	}
	if (!householdId && !hasAnyHousehold) error(404, { message: 'No households available.' });
	if (!householdId) error(400, { message: 'Household is required.' });

	return { session, householdId, database, db: getDb(database) };
};

export const requireBillingAppContext = async (
	input: AppContextInput
): Promise<AuthenticatedAppContext> => {
	const context = await requireAppContext(input);

	await requireHouseholdAccess({
		platform: input.platform,
		database: context.database,
		session: context.session,
		householdId: context.householdId
	});

	return context;
};
