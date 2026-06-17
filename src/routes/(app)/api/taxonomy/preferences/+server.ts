import { error, isHttpError, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { households } from '$lib/server/db/schema';
import { requireAppContext } from '$lib/server/http/app-context';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	try {
		const profileRows = await db
			.select({ locale: households.locale })
			.from(households)
			.where(eq(households.householdId, householdId))
			.limit(1);
		const locale = url.searchParams.get('locale')?.trim() || profileRows[0]?.locale || 'en-US';

		return json(
			await loadEffectiveTaxonomyPreferences(db, {
				workosUserId: session.user.id,
				householdId,
				locale
			}),
			{ headers: { 'cache-control': 'private, max-age=60' } }
		);
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to load taxonomy preferences', cause);
		error(503, { message: 'Taxonomy preferences unavailable.' });
	}
};
