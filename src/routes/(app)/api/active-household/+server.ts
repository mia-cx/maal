import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	activateRequiredHouseholdId,
	resolveRequiredActiveHouseholdId
} from '$lib/server/http/app-context';
import { readJsonObject } from '$lib/server/http/request';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const householdId = await resolveRequiredActiveHouseholdId({
		platform,
		cookies,
		url,
		session
	});
	return json({ householdId });
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	const body = await readJsonObject(request, {
		onParseError: (cause) => console.warn('Invalid active-household request body', cause)
	});
	const householdId =
		typeof body.householdId === 'string' && body.householdId.trim()
			? body.householdId.trim()
			: null;
	if (!householdId) error(400, { message: 'Household ID is required.' });

	const activatedHouseholdId = await activateRequiredHouseholdId({
		platform,
		cookies,
		url,
		session,
		householdId
	});
	return json({ householdId: activatedHouseholdId });
};
