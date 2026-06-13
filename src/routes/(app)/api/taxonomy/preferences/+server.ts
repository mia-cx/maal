import { json, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { resolveActiveHouseholdId } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { households } from '$lib/server/db/schema';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	if (!locals.session) redirect(302, '/auth/login');
	if (!platform?.env.DB) return json({ message: 'Database is not available.' }, { status: 500 });

	const { householdId } = await resolveActiveHouseholdId({
		platform,
		cookies,
		url,
		session: locals.session
	});
	if (!householdId) return json({ message: 'Household is required.' }, { status: 400 });

	const db = getDb(platform.env.DB);
	const profileRows = await db
		.select({ locale: households.locale })
		.from(households)
		.where(eq(households.householdId, householdId))
		.limit(1);
	const locale = url.searchParams.get('locale')?.trim() || profileRows[0]?.locale || 'en-US';

	return json(
		await loadEffectiveTaxonomyPreferences(db, {
			workosUserId: locals.session.user.id,
			householdId,
			locale
		}),
		{ headers: { 'cache-control': 'private, max-age=60' } }
	);
};
