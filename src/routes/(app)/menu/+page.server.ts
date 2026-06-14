import { redirect } from '@sveltejs/kit';
import { commitHouseholdCookie, listUserHouseholds } from '$lib/server/auth/household';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { loadMenuRecipes } from '$lib/server/db/recipe-mappers';
import { households } from '$lib/server/db/schema';
import { firstAccessibleHouseholdId, hasHouseholdAccess } from '$lib/server/billing/entitlements';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import { MENU_RECIPE_PAGE_SIZE } from '$lib/menu/pagination';
import { rankRecipesByRelevance } from '$lib/menu/recipe-ranking';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, parent, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');
	if (!platform?.env.DB) return { recipes: [], nextRecipeOffset: null };

	let { activeHouseholdId: householdId } = await parent();
	if (!householdId) redirect(303, '/onboarding');

	const activeHouseholdHasAccess = await hasHouseholdAccess({
		platform,
		database: platform.env.DB,
		householdId
	});
	if (!activeHouseholdHasAccess) {
		const households = await listUserHouseholds(platform, session.user.id).catch(() => []);
		householdId =
			(await firstAccessibleHouseholdId({ platform, database: platform.env.DB, households })) ??
			householdId;
	}
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
	const [recipes, archivedRecipes] = await Promise.all([
		loadMenuRecipes(db, session.user.id, householdId, {
			unitPreferences: taxonomyPreferences.unitPreferences
		}),
		loadMenuRecipes(db, session.user.id, householdId, {
			archive: 'archived',
			unitPreferences: taxonomyPreferences.unitPreferences
		})
	]);
	const rankedRecipes = rankRecipesByRelevance(recipes);
	return {
		recipes: rankedRecipes.slice(0, MENU_RECIPE_PAGE_SIZE),
		archivedRecipes: rankRecipesByRelevance(archivedRecipes),
		nextRecipeOffset: rankedRecipes.length > MENU_RECIPE_PAGE_SIZE ? MENU_RECIPE_PAGE_SIZE : null
	};
};
