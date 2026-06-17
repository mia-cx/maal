import { error, isHttpError, json } from '@sveltejs/kit';
import { requireAppContext } from '$lib/server/http/app-context';
import { loadHouseholdTaxonomyPreferences } from '$lib/server/taxonomy/household-preferences';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	try {
		return json(
			await loadHouseholdTaxonomyPreferences(db, {
				workosUserId: session.user.id,
				householdId,
				locale: url.searchParams.get('locale')?.trim() || null
			}),
			{ headers: { 'cache-control': 'private, max-age=60' } }
		);
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		console.error('Failed to load taxonomy preferences', cause);
		error(503, { message: 'Taxonomy preferences unavailable.' });
	}
};
