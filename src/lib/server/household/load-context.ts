import { redirect } from '@sveltejs/kit';

export const requireLoadedHousehold = async ({
	locals,
	parent
}: {
	locals: App.Locals;
	parent: () => Promise<{ activeHouseholdId?: string | null }>;
}) => {
	if (!locals.session) redirect(302, '/auth/login');
	const layout = await parent();
	if (!layout.activeHouseholdId) redirect(302, '/onboarding');
	return { session: locals.session, householdId: layout.activeHouseholdId };
};
