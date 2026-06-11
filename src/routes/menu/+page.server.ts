import { redirect } from '@sveltejs/kit';
import { commitHouseholdCookie } from '$lib/server/auth/household';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { loadMenuRecipes } from '$lib/server/db/recipe-mappers';
import { households } from '$lib/server/db/schema';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import type { PageServerLoad } from './$types';

const initialRecipeLimit = 24;

export const load: PageServerLoad = async ({ cookies, locals, parent, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');
	if (!platform?.env.DB) return { recipes: [], nextRecipeOffset: null };

	const { activeHouseholdId: householdId } = await parent();
	if (!householdId) redirect(303, '/onboarding');
	commitHouseholdCookie(cookies, householdId, url);

	const db = getDb(platform.env.DB);
	const profileRows = await db
		.select({ locale: households.locale })
		.from(households)
		.where(eq(households.householdId, householdId))
		.limit(1);
	const taxonomyPreferences = await loadEffectiveTaxonomyPreferences(db, {
		workosUserId: session.user.id,
		householdId,
		locale: profileRows[0]?.locale ?? 'en-US'
	});
	const recipes = await loadMenuRecipes(db, session.user.id, householdId, {
		limit: initialRecipeLimit + 1,
		unitPreferences: taxonomyPreferences.unitPreferences
	});
	const hasMoreRecipes = recipes.length > initialRecipeLimit;
	return {
		recipes: recipes.slice(0, initialRecipeLimit),
		nextRecipeOffset: hasMoreRecipes ? initialRecipeLimit : null
	};
};
