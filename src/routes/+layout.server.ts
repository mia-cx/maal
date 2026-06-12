import type { LayoutServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { readHouseholdCookie, listUserHouseholds } from '$lib/server/auth/household';
import { toPublicSession } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { households as householdProfiles } from '$lib/server/db/schema';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';

export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
	const session = locals.session;
	const userHouseholds = session
		? await listUserHouseholds(platform, session.user.id).catch(() => [])
		: [];
	const requestedHouseholdId = session?.organizationId ?? readHouseholdCookie(cookies);
	const activeHouseholdId =
		requestedHouseholdId &&
		userHouseholds.some((household) => household.id === requestedHouseholdId)
			? requestedHouseholdId
			: (userHouseholds[0]?.id ?? null);

	let taxonomyPreferences = null;
	if (session && activeHouseholdId && platform?.env.DB) {
		const db = getDb(platform.env.DB);
		const profileRows = await db
			.select({ locale: householdProfiles.locale })
			.from(householdProfiles)
			.where(eq(householdProfiles.householdId, activeHouseholdId))
			.limit(1);
		taxonomyPreferences = await loadEffectiveTaxonomyPreferences(db, {
			workosUserId: session.user.id,
			householdId: activeHouseholdId,
			locale: profileRows[0]?.locale ?? 'en-US'
		});
	}

	return {
		session: toPublicSession(session),
		households: userHouseholds,
		activeHouseholdId,
		taxonomyPreferences
	};
};
