import type { LayoutServerLoad } from './$types';
import {
	canManageActiveHousehold,
	listUserHouseholds,
	readHouseholdCookie
} from '$lib/server/auth/household';
import { toPublicSession } from '$lib/server/auth/session';
import { hasHouseholdBillingGrant } from '$lib/server/domains/billing';
import { loadBillingStatus } from '$lib/server/domains/billing';

export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
	const session = locals.session;
	const userHouseholds = session
		? await listUserHouseholds(platform, session.user.id).catch(() => [])
		: [];
	const userHouseholdIds = new Set(userHouseholds.map((household) => household.id));
	const cookieHouseholdId = readHouseholdCookie(cookies);
	const activeHouseholdId = session?.organizationId
		? session.organizationId
		: cookieHouseholdId && userHouseholdIds.has(cookieHouseholdId)
			? cookieHouseholdId
			: (userHouseholds[0]?.id ?? null);

	let subscriptionLock = null;
	if (session && activeHouseholdId && platform?.env.DB) {
		const billing = await loadBillingStatus(platform.env.DB, activeHouseholdId);
		const hasAccess =
			billing.isPaid ||
			(await hasHouseholdBillingGrant({ platform, householdId: activeHouseholdId }).catch(
				() => false
			));
		const canManageSubscription = hasAccess
			? false
			: await canManageActiveHousehold(platform, session, activeHouseholdId);
		subscriptionLock = {
			locked: !hasAccess,
			status: billing.status,
			canManageSubscription
		};
	}

	return {
		session: toPublicSession(session),
		households: userHouseholds,
		activeHouseholdId,
		subscriptionLock
	};
};
