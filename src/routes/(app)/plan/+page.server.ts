import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { commitHouseholdCookie } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { households } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number): Date => {
	const nextDate = new Date(date);
	nextDate.setDate(nextDate.getDate() + days);
	return nextDate;
};

const weekStartsOnName = (value?: number | null): 'sunday' | 'monday' =>
	value === 0 ? 'sunday' : 'monday';

export const load: PageServerLoad = async ({ cookies, locals, parent, platform, url }) => {
	const session = locals.session;
	if (!session) redirect(303, '/auth/login');
	if (!platform?.env.DB) return { meals: [], recipes: [], defaultMealServings: 1 };

	const { activeHouseholdId: householdId } = await parent();
	if (!householdId) redirect(303, '/onboarding');
	commitHouseholdCookie(cookies, householdId, url);

	const db = getDb(platform.env.DB);
	const initialDate = new Date();
	const initialStartDate = dateKey(addDays(initialDate, -7));
	const initialEndDate = dateKey(addDays(initialDate, 14));
	const profileRows = await db
		.select({
			defaultPlannedYield: households.defaultPlannedYield,
			weekStartsOn: households.weekStartsOn
		})
		.from(households)
		.where(eq(households.householdId, householdId))
		.limit(1);
	const householdProfile = profileRows[0];
	return {
		recipes: [],
		defaultMealServings: householdProfile?.defaultPlannedYield ?? 1,
		weekStartsOn: weekStartsOnName(householdProfile?.weekStartsOn),
		householdMembers: [],
		unitPreferences: {},
		initialMealRange: { start: initialStartDate, end: initialEndDate },
		meals: []
	};
};
