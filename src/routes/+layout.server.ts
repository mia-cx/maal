import type { LayoutServerLoad } from './$types';
import { readHouseholdCookie, listUserHouseholds } from '$lib/server/auth/household';
import { toPublicSession } from '$lib/server/auth/session';

export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
	const session = locals.session;
	const households = session
		? await listUserHouseholds(platform, session.user.id).catch(() => [])
		: [];
	const activeHouseholdId = session?.organizationId ?? readHouseholdCookie(cookies);

	return {
		session: toPublicSession(session),
		households,
		activeHouseholdId:
			activeHouseholdId && households.some((household) => household.id === activeHouseholdId)
				? activeHouseholdId
				: (households[0]?.id ?? null)
	};
};
