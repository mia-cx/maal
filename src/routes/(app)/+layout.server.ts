import * as m from '$lib/paraglide/messages';
import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { toPublicSession } from '$lib/server/auth/session';
import { hasHouseholdBillingGrant } from '$lib/server/domains/billing';
import { loadFreshBillingStatus } from '$lib/server/domains/billing';
import { loadHouseholdParaglideLocale } from '$lib/server/i18n/household-locale';

export const load: LayoutServerLoad = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	let userHouseholds: Awaited<ReturnType<typeof listUserHouseholds>> = [];
	if (session) {
		try {
			userHouseholds = await listUserHouseholds(platform, session.user.id);
		} catch (cause) {
			console.error('Failed to load app households', cause);
			error(503, { message: m.billing_could_not_load_your_households_try_again_in_() });
		}
	}
	const { householdId: activeHouseholdId } = session
		? await resolveActiveHouseholdId({
				platform,
				cookies,
				url,
				session,
				householdIds: userHouseholds.map((household) => household.id)
			})
		: { householdId: null };

	const householdParaglideLocale = session
		? await loadHouseholdParaglideLocale({ platform, householdId: activeHouseholdId })
		: null;

	let subscriptionLock = null;
	if (session && activeHouseholdId && platform?.env.DB) {
		const hasGrant = await hasHouseholdBillingGrant({
			platform,
			householdId: activeHouseholdId
		}).catch(() => false);
		const billing = hasGrant ? null : await loadFreshBillingStatus(platform, activeHouseholdId);
		const hasAccess = hasGrant || Boolean(billing?.isPaid);
		const canManageSubscription = hasAccess
			? false
			: await canManageActiveHousehold(platform, session, activeHouseholdId);
		subscriptionLock = {
			locked: !hasAccess,
			status: billing?.status ?? 'active',
			canManageSubscription
		};
	}

	return {
		session: toPublicSession(session),
		households: userHouseholds,
		activeHouseholdId,
		householdParaglideLocale,
		subscriptionLock
	};
};
