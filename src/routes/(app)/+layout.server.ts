import type { LayoutServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { toPublicSession } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { households as householdProfiles } from '$lib/server/db/schema';
import { hasHouseholdAccess } from '$lib/server/billing/entitlements';
import { loadBillingStatus } from '$lib/server/billing/subscriptions';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';

export const load: LayoutServerLoad = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	const userHouseholds = session
		? await listUserHouseholds(platform, session.user.id).catch(() => [])
		: [];
	const activeHousehold = session
		? await resolveActiveHouseholdId({ platform, cookies, url, session })
		: { householdId: null, hasAnyHousehold: false };
	const activeHouseholdId = activeHousehold.householdId;

	let taxonomyPreferences = null;
	let subscriptionLock = null;
	if (session && activeHouseholdId && platform?.env.DB) {
		const [billing, hasAccess, canManageSubscription] = await Promise.all([
			loadBillingStatus(platform.env.DB, activeHouseholdId),
			hasHouseholdAccess({ database: platform.env.DB, session, householdId: activeHouseholdId }),
			canManageActiveHousehold(platform, session, activeHouseholdId)
		]);
		subscriptionLock = {
			locked: !hasAccess,
			status: billing.status,
			canManageSubscription
		};

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
		taxonomyPreferences,
		subscriptionLock
	};
};
