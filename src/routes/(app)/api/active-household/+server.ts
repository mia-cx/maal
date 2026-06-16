import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	commitHouseholdCookie,
	listUserHouseholdIds,
	readHouseholdCookie
} from '$lib/server/auth/household';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const GET: RequestHandler = async ({ cookies }) => {
	return json({ householdId: readHouseholdCookie(cookies) });
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}

	const householdId =
		isRecord(body) && typeof body.householdId === 'string' ? body.householdId : null;
	if (!householdId) error(400, { message: 'Household ID is required.' });

	const householdIds = await listUserHouseholdIds(platform, session.user.id);
	if (!householdIds.includes(householdId)) error(403, { message: 'Household is not accessible.' });

	commitHouseholdCookie(cookies, householdId, url);
	return json({ householdId });
};
