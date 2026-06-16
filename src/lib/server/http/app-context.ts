import { error, isHttpError, type Cookies } from '@sveltejs/kit';
import type { AuthSession } from '$lib/server/auth/session';
import {
	activateRequestedHouseholdId,
	resolveActiveHouseholdId,
	type RequestedHouseholdActivation
} from '$lib/server/auth/household';
import { requireHouseholdAccess } from '$lib/server/domains/billing';
import { getDb } from '$lib/server/db';

export type HouseholdResolution = {
	householdId: string | null;
	hasAnyHousehold: boolean;
};

export const requireResolvedHouseholdId = (resolution: HouseholdResolution): string => {
	if (!resolution.householdId && !resolution.hasAnyHousehold) {
		error(404, { message: 'No households available.' });
	}
	if (!resolution.householdId) error(400, { message: 'Household is required.' });
	return resolution.householdId;
};

export const requireActivatedHousehold = (activation: RequestedHouseholdActivation): string => {
	if (activation.status === 'inaccessible' && !activation.hasAnyHousehold) {
		error(404, { message: 'No households available.' });
	}
	if (activation.status !== 'activated') error(403, { message: 'Household is not accessible.' });
	return activation.householdId;
};

export const mapHouseholdResolutionFailure = (cause: unknown): never => {
	if (isHttpError(cause)) throw cause;
	console.error('Failed to resolve active household', cause);
	error(503, { message: 'Household service unavailable.' });
};

export const mapHouseholdActivationFailure = (cause: unknown): never => {
	if (isHttpError(cause)) throw cause;
	console.error('Failed to activate household', cause);
	error(503, { message: 'Household service unavailable.' });
};

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

	let householdId: string;
	try {
		householdId = requireResolvedHouseholdId(
			await resolveActiveHouseholdId({
				platform: input.platform,
				cookies: input.cookies,
				url: input.url,
				session
			})
		);
	} catch (cause) {
		return mapHouseholdResolutionFailure(cause);
	}

	return { session, householdId, database, db: getDb(database) };
};

export const resolveRequiredActiveHouseholdId = async (input: {
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
	session: AuthSession;
}): Promise<string> => {
	try {
		return requireResolvedHouseholdId(await resolveActiveHouseholdId(input));
	} catch (cause) {
		return mapHouseholdResolutionFailure(cause);
	}
};

export const activateRequiredHouseholdId = async (input: {
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
	session: AuthSession;
	householdId: string;
}): Promise<string> => {
	try {
		return requireActivatedHousehold(await activateRequestedHouseholdId(input));
	} catch (cause) {
		return mapHouseholdActivationFailure(cause);
	}
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
