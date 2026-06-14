import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { canManageActiveHousehold, resolveActiveHouseholdId } from '$lib/server/auth/household';

export const requireActionHousehold = async (event: {
	locals: App.Locals;
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
}) => {
	if (!event.locals.session) redirect(302, '/auth/login');
	const { householdId } = await resolveActiveHouseholdId({
		platform: event.platform,
		cookies: event.cookies,
		url: event.url,
		session: event.locals.session
	});
	if (!householdId) redirect(302, '/onboarding');
	return { session: event.locals.session, householdId };
};

export const requireManageHousehold = async (event: {
	locals: App.Locals;
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
}) => {
	const household = await requireActionHousehold(event);
	if (!(await canManageActiveHousehold(event.platform, household.session, household.householdId))) {
		return fail(403, { message: 'You do not have permission to manage this household.' });
	}
	return household;
};
