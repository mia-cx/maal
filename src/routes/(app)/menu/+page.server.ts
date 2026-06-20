import { redirect } from '@sveltejs/kit';
import { commitHouseholdCookie } from '$lib/server/auth/household';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, parent, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');
	if (!platform?.env.DB) return { recipes: [], archivedRecipes: [], nextRecipeOffset: null };

	const { activeHouseholdId: householdId } = await parent();
	if (!householdId) redirect(303, '/onboarding');
	commitHouseholdCookie(cookies, householdId, url);

	return {
		recipes: [],
		archivedRecipes: [],
		nextRecipeOffset: null,
		unitPreferences: {}
	};
};
