import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { listUserHouseholds } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');

	const creatingAdditionalHousehold = url.searchParams.get('new') === '1';
	const households = await listUserHouseholds(platform, session.user.id).catch(() => []);
	if (households.length > 0 && !creatingAdditionalHousehold) redirect(303, '/plan');

	let canStartTrial = false;
	if (platform?.env.DB) {
		const [userRow] = await getDb(platform.env.DB)
			.select({ trialHouseholdId: users.trialHouseholdId })
			.from(users)
			.where(eq(users.workosUserId, session.user.id))
			.limit(1);
		canStartTrial = !userRow?.trialHouseholdId;
	}

	const userName = session.user.firstName ?? session.user.name ?? session.user.email.split('@')[0];
	return {
		defaultHouseholdName: `${userName}'s kitchen`,
		canStartTrial,
		hasHouseholds: households.length > 0
	};
};
