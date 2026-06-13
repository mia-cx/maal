import { error, json, type RequestHandler } from '@sveltejs/kit';
import { createHouseholdForUser } from '$lib/server/auth/household';
import { startHouseholdTrial } from '$lib/server/billing/trials';

const maxHouseholdNameLength = 120;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}
	if (!isRecord(body) || typeof body.name !== 'string') {
		error(400, { message: 'Household name is required.' });
	}

	const startTrialRequested = body.startTrial === true;
	const name = body.name.trim();
	if (!name) error(400, { message: 'Household name is required.' });
	if (name.length > maxHouseholdNameLength) error(400, { message: 'Household name is too long.' });

	try {
		const household = await createHouseholdForUser({
			platform,
			cookies,
			url,
			userId: session.user.id,
			name
		});
		let trialStarted = false;
		if (startTrialRequested) {
			try {
				await startHouseholdTrial({
					platform,
					user: session.user,
					householdId: household.id
				});
				trialStarted = true;
			} catch (cause) {
				console.warn('Created household without starting trial', cause);
			}
		}
		return json(
			{ household: { id: household.id, name: household.name }, trialStarted },
			{ status: 201 }
		);
	} catch (cause) {
		console.error('Failed to create household', cause);
		error(502, { message: 'Could not create household.' });
	}
};
