import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { commitHouseholdCookie, countActiveHouseholdMembers } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { loadMealPlanMeals, loadMenuRecipes } from '$lib/server/db/recipe-mappers';
import { householdProfiles } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number): Date => {
	const nextDate = new Date(date);
	nextDate.setDate(nextDate.getDate() + days);
	return nextDate;
};

export const load: PageServerLoad = async ({ cookies, locals, parent, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');
	if (!platform?.env.DB) return { meals: [], recipes: [], defaultMealServings: 1 };

	const { activeHouseholdId: householdId } = await parent();
	if (!householdId) redirect(303, '/onboarding');
	commitHouseholdCookie(cookies, householdId, url);

	const db = getDb(platform.env.DB);
	const initialDate = new Date();
	const initialStartDate = dateKey(addDays(initialDate, -45));
	const initialEndDate = dateKey(addDays(initialDate, 90));
	const [activeMemberCount, profileRows] = await Promise.all([
		countActiveHouseholdMembers(platform, householdId),
		db
			.select({
				defaultServings: householdProfiles.defaultServings,
				weekStartsOn: householdProfiles.weekStartsOn,
				preferredMassUnit: householdProfiles.preferredMassUnit,
				preferredVolumeUnit: householdProfiles.preferredVolumeUnit,
				ingredientUnitOverrides: householdProfiles.ingredientUnitOverrides
			})
			.from(householdProfiles)
			.where(eq(householdProfiles.householdId, householdId))
			.limit(1)
	]);
	const householdProfile = profileRows[0];
	const defaultMealServings = householdProfile?.defaultServings ?? activeMemberCount;
	const unitPreferences = {
		preferredMassUnit: householdProfile?.preferredMassUnit ?? 'g',
		preferredVolumeUnit: householdProfile?.preferredVolumeUnit ?? 'ml',
		ingredientUnitOverrides: householdProfile?.ingredientUnitOverrides ?? {}
	};
	const recipes = await loadMenuRecipes(db, session.user.id, householdId, { unitPreferences });
	return {
		recipes,
		defaultMealServings,
		weekStartsOn: householdProfile?.weekStartsOn ?? 'monday',
		unitPreferences,
		initialMealRange: { start: initialStartDate, end: initialEndDate },
		meals: await loadMealPlanMeals(db, {
			workosUserId: session.user.id,
			householdId,
			defaultMealServings,
			startDate: initialStartDate,
			endDate: initialEndDate,
			menuRecipes: recipes
		})
	};
};
