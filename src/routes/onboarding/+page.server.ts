import { redirect } from '@sveltejs/kit';
import { listUserHouseholds } from '$lib/server/auth/household';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');

	const households = await listUserHouseholds(platform, session.user.id).catch(() => []);
	if (households.length > 0) redirect(303, '/plan');

	const userName = session.user.firstName ?? session.user.name ?? session.user.email.split('@')[0];
	return { defaultHouseholdName: `${userName}'s kitchen` };
};
