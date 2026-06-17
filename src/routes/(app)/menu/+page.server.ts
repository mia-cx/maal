import { error, redirect } from '@sveltejs/kit';
import { commitHouseholdCookie, listUserHouseholds } from '$lib/server/auth/household';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { loadMenuRecipes } from '$lib/server/db/recipe-mappers';
import { households } from '$lib/server/db/schema';
import { firstAccessibleHouseholdId, hasHouseholdAccess } from '$lib/server/domains/billing';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import { MENU_RECIPE_PAGE_SIZE } from '$lib/menu/pagination';
import { rankRecipesByRelevance } from '$lib/menu/recipe-ranking';
import type { PageServerLoad } from './$types';

const resolveFallbackHouseholdId = async (
	platform: App.Platform,
	workosUserId: string
): Promise<string | null> => {
	try {
		const households = await listUserHouseholds(platform, workosUserId);
		return await firstAccessibleHouseholdId({ platform, households });
	} catch (cause) {
		console.error('Failed to resolve fallback household for menu route', cause);
		error(503, { message: 'Could not load your households. Try again in a moment.' });
	}
};

export const load: PageServerLoad = async ({ cookies, locals, parent, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');
	if (!platform?.env.DB) return { recipes: [], nextRecipeOffset: null };

	let { activeHouseholdId: householdId } = await parent();
	if (!householdId) redirect(303, '/onboarding');

	const activeHouseholdHasAccess = await hasHouseholdAccess({
		platform,
		householdId
	});
	if (!activeHouseholdHasAccess) {
		const accessibleHouseholdId = await resolveFallbackHouseholdId(platform, session.user.id);
		if (!accessibleHouseholdId) redirect(303, '/subscribe');
		householdId = accessibleHouseholdId;
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
	const recipeRows = await loadMenuRecipes(db, session.user.id, householdId, {
		limit: MENU_RECIPE_PAGE_SIZE + 1,
		unitPreferences: taxonomyPreferences.unitPreferences
	});
	const recipes = rankRecipesByRelevance(recipeRows).slice(0, MENU_RECIPE_PAGE_SIZE);
	const archivedRecipes = rankRecipesByRelevance(
		await loadMenuRecipes(db, session.user.id, householdId, {
			archive: 'archived',
			unitPreferences: taxonomyPreferences.unitPreferences
		})
	);
	const nextRecipeOffset = recipeRows.length > MENU_RECIPE_PAGE_SIZE ? MENU_RECIPE_PAGE_SIZE : null;
	return {
		recipes,
		archivedRecipes,
		nextRecipeOffset,
		unitPreferences: taxonomyPreferences.unitPreferences
	};
};
