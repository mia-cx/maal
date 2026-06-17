import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { resolveActiveHouseholdId } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { householdMeals, userRecipes } from '$lib/server/db/schema';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: m.app_sign_in_required() });
	if (!platform?.env.DB) error(503, { message: m.app_database_unavailable() });

	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(404, { message: m.app_no_household_found() });

	const db = getDb(platform.env.DB);
	const [recipes, meals] = await Promise.all([
		db.select().from(userRecipes).where(eq(userRecipes.workosUserId, session.user.id)),
		db.select().from(householdMeals).where(eq(householdMeals.householdId, householdId))
	]);

	return json(
		{
			exportedAt: new Date().toISOString(),
			householdId,
			userId: session.user.id,
			recipes,
			meals
		},
		{
			headers: {
				'content-disposition': `attachment; filename="maal-export-${householdId}.json"`
			}
		}
	);
};
