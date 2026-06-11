import type { Cookies } from '@sveltejs/kit';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { provisionAuthSession } from '$lib/server/auth/provisioning';
import { SMOKE_HOUSEHOLD_ID, SMOKE_HOUSEHOLD_NAME, SMOKE_USER_ID, smokeAuthEnabled } from './smoke';

export const HOUSEHOLD_COOKIE_NAME = 'maal_household_id';
export const HOUSEHOLD_MANAGE_PERMISSION = 'household:manage';

const householdCookieOptions = (url: URL) => ({
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: url.protocol === 'https:',
	maxAge: 60 * 60 * 24 * 365
});

export const readHouseholdCookie = (cookies: Cookies): string | null =>
	cookies.get(HOUSEHOLD_COOKIE_NAME) ?? null;

export const commitHouseholdCookie = (cookies: Cookies, householdId: string, url: URL) => {
	cookies.set(HOUSEHOLD_COOKIE_NAME, householdId, householdCookieOptions(url));
};

export const clearHouseholdCookie = (cookies: Cookies): void => {
	cookies.delete(HOUSEHOLD_COOKIE_NAME, { path: '/' });
};

export const canManageHousehold = (
	session: {
		organizationId?: string | null;
		permissions?: string[];
	},
	householdId: string
): boolean =>
	session.organizationId === householdId &&
	(session.permissions ?? []).includes(HOUSEHOLD_MANAGE_PERMISSION);

export const canManageActiveHousehold = async (
	platform: App.Platform | undefined,
	session: { user: { id: string }; organizationId?: string | null; permissions?: string[] },
	householdId: string
): Promise<boolean> => {
	if (canManageHousehold(session, householdId)) return true;
	if (smokeAuthEnabled(platform) && session.user.id === SMOKE_USER_ID) return true;

	try {
		const runtime = createAuthRuntime(platform);
		const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
			organizationId: householdId,
			userId: session.user.id,
			statuses: ['active'],
			limit: 1
		});
		const membership = memberships.data[0];
		if (!membership) return false;

		const roleSlugs = new Set([
			membership.role.slug,
			...(membership.roles ?? []).map((role) => role.slug)
		]);
		const roles = await Promise.all(
			Array.from(roleSlugs).map((slug) =>
				runtime.workos.authorization.getOrganizationRole(householdId, slug).catch(() => null)
			)
		);
		return roles.some((role) => role?.permissions.includes(HOUSEHOLD_MANAGE_PERMISSION));
	} catch {
		return false;
	}
};

export type UserHousehold = { id: string; name: string };

export const listUserHouseholds = async (
	platform: App.Platform | undefined,
	userId: string
): Promise<UserHousehold[]> => {
	if (smokeAuthEnabled(platform) && userId === SMOKE_USER_ID) {
		return [{ id: SMOKE_HOUSEHOLD_ID, name: SMOKE_HOUSEHOLD_NAME }];
	}
	const runtime = createAuthRuntime(platform);
	const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
		userId,
		statuses: ['active'],
		limit: 25
	});
	return memberships.data.map((membership) => ({
		id: membership.organizationId,
		name: membership.organizationName
	}));
};

export const listUserHouseholdIds = async (platform: App.Platform | undefined, userId: string) =>
	(await listUserHouseholds(platform, userId)).map((household) => household.id);

export const countActiveHouseholdMembers = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<number> => {
	if (smokeAuthEnabled(platform) && householdId === SMOKE_HOUSEHOLD_ID) return 4;
	const runtime = createAuthRuntime(platform);
	const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
		organizationId: householdId,
		statuses: ['active'],
		limit: 100
	});
	return Math.max(1, memberships.data.length);
};

export const resolveActiveHouseholdId = async (input: {
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
	session: { user: { id: string }; organizationId?: string | null };
}): Promise<{ householdId: string | null; hasAnyHousehold: boolean }> => {
	if (input.session.organizationId) {
		commitHouseholdCookie(input.cookies, input.session.organizationId, input.url);
		return { householdId: input.session.organizationId, hasAnyHousehold: true };
	}

	const cookieHouseholdId = readHouseholdCookie(input.cookies);
	const householdIds = await listUserHouseholdIds(input.platform, input.session.user.id);
	const householdId =
		cookieHouseholdId && householdIds.includes(cookieHouseholdId)
			? cookieHouseholdId
			: (householdIds[0] ?? null);

	if (householdId) commitHouseholdCookie(input.cookies, householdId, input.url);
	return { householdId, hasAnyHousehold: householdIds.length > 0 };
};

export const createHouseholdForUser = async (input: {
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
	userId: string;
	name: string;
}) => {
	const runtime = createAuthRuntime(input.platform);
	const organization = await runtime.workos.organizations.createOrganization({ name: input.name });
	await runtime.workos.userManagement.createOrganizationMembership({
		organizationId: organization.id,
		userId: input.userId,
		roleSlug: 'admin'
	});
	await provisionAuthSession(input.platform, {
		user: { id: input.userId },
		organizationId: organization.id
	});
	commitHouseholdCookie(input.cookies, organization.id, input.url);
	return organization;
};
