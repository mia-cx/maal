import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { commitHouseholdCookie } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { loadMenuRecipes } from '$lib/server/db/recipe-mappers';
import { householdProfiles } from '$lib/server/db/schema';
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
	const profile = await db
		.select({
			preferredMassUnit: householdProfiles.preferredMassUnit,
			preferredVolumeUnit: householdProfiles.preferredVolumeUnit,
			ingredientUnitOverrides: householdProfiles.ingredientUnitOverrides
		})
		.from(householdProfiles)
		.where(eq(householdProfiles.householdId, householdId))
		.limit(1)
		.get();
	const recipes = await loadMenuRecipes(db, session.user.id, householdId, {
		limit: initialRecipeLimit + 1,
		unitPreferences: {
			preferredMassUnit: profile?.preferredMassUnit ?? 'g',
			preferredVolumeUnit: profile?.preferredVolumeUnit ?? 'ml',
			ingredientUnitOverrides: profile?.ingredientUnitOverrides ?? {}
		}
	});
	const hasMoreRecipes = recipes.length > initialRecipeLimit;
	return {
		recipes: recipes.slice(0, initialRecipeLimit),
		nextRecipeOffset: hasMoreRecipes ? initialRecipeLimit : null
	};
};
