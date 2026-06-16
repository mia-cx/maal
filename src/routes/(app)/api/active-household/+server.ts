import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import {
	activateRequestedHouseholdId,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { readJsonObject } from '$lib/server/http/request';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	try {
		const { householdId, hasAnyHousehold } = await resolveActiveHouseholdId({
			platform,
			cookies,
			url,
			session
		});
		if (!householdId && !hasAnyHousehold) error(404, { message: 'No households available.' });
		if (!householdId) error(400, { message: 'Household is required.' });
		return json({ householdId });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to load active household', cause);
		error(503, { message: 'Household service unavailable.' });
	}
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const body = await readJsonObject(request, {
		onParseError: (cause) => console.warn('Invalid active-household request body', cause)
	});
	const householdId =
		typeof body.householdId === 'string' && body.householdId.trim() ? body.householdId.trim() : null;
	if (!householdId) error(400, { message: 'Household ID is required.' });

	try {
		const activation = await activateRequestedHouseholdId({
			platform,
			cookies,
			url,
			session,
			householdId
		});
		if (activation.status === 'inaccessible' && !activation.hasAnyHousehold) {
			error(404, { message: 'No households available.' });
		}
		if (activation.status !== 'activated') {
			error(403, { message: 'Household is not accessible.' });
		}

		return json({ householdId: activation.householdId });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to activate household', cause);
		error(503, { message: 'Household service unavailable.' });
	}
};
