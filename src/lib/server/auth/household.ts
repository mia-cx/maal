import type { Cookies } from '@sveltejs/kit';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { provisionAuthSession } from '$lib/server/auth/provisioning';
import { displayUserName } from '$lib/server/auth/user-display';
import { SMOKE_HOUSEHOLD_ID, SMOKE_HOUSEHOLD_NAME, SMOKE_USER_ID, smokeAuthEnabled } from './smoke';

export const HOUSEHOLD_COOKIE_NAME = 'maal_household_id';
export const HOUSEHOLD_MANAGE_PERMISSION = 'households:write';
const LEGACY_HOUSEHOLD_MANAGE_PERMISSION = 'household:manage';
const MEALS_ATTEND_PERMISSION = 'household:meals:attend';
const MEALS_MANAGE_PERMISSION = 'household:meals:manage';

export type MaalHouseholdPermission =
	| 'recipes:read'
	| 'recipes:write'
	| 'meals:read'
	| 'meals:write';

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
	((session.permissions ?? []).includes(HOUSEHOLD_MANAGE_PERMISSION) ||
		(session.permissions ?? []).includes(LEGACY_HOUSEHOLD_MANAGE_PERMISSION));

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
		return roles.some(
			(role) =>
				role?.permissions.includes(HOUSEHOLD_MANAGE_PERMISSION) ||
				role?.permissions.includes(LEGACY_HOUSEHOLD_MANAGE_PERMISSION)
		);
	} catch {
		return false;
	}
};

export type UserHousehold = { id: string; name: string };

export type HouseholdMember = {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: string;
	directoryManaged: boolean;
	createdAt: string;
};

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

const workosPermissionsAllow = (
	permissions: readonly string[],
	permission: MaalHouseholdPermission
): boolean => {
	const granted = new Set(permissions);
	if (granted.has(permission) || granted.has(HOUSEHOLD_MANAGE_PERMISSION)) return true;
	if (granted.has(LEGACY_HOUSEHOLD_MANAGE_PERMISSION)) return true;

	if (permission === 'meals:read') {
		return granted.has(MEALS_ATTEND_PERMISSION) || granted.has(MEALS_MANAGE_PERMISSION);
	}
	if (
		permission === 'meals:write' ||
		permission === 'recipes:read' ||
		permission === 'recipes:write'
	) {
		return granted.has(MEALS_MANAGE_PERMISSION);
	}
	return false;
};

export const userHasHouseholdPermission = async (
	platform: App.Platform | undefined,
	userId: string,
	householdId: string,
	permission: MaalHouseholdPermission
): Promise<boolean> => {
	if (
		smokeAuthEnabled(platform) &&
		userId === SMOKE_USER_ID &&
		householdId === SMOKE_HOUSEHOLD_ID
	) {
		return true;
	}

	try {
		const runtime = createAuthRuntime(platform);
		const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
			organizationId: householdId,
			userId,
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
		return roles.some((role) => workosPermissionsAllow(role?.permissions ?? [], permission));
	} catch {
		return false;
	}
};

export const listHouseholdMembers = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<HouseholdMember[]> => {
	if (smokeAuthEnabled(platform) && householdId === SMOKE_HOUSEHOLD_ID) {
		return [
			{
				id: 'membership_smoke_maal',
				userId: SMOKE_USER_ID,
				name: 'Smoke User',
				email: 'smoke@example.com',
				role: 'admin',
				directoryManaged: false,
				createdAt: new Date(0).toISOString()
			},
			{
				id: 'membership_smoke_sam',
				userId: 'user_smoke_sam',
				name: 'Sam Smoke',
				email: 'sam@example.com',
				role: 'member',
				directoryManaged: false,
				createdAt: new Date(0).toISOString()
			},
			{
				id: 'membership_smoke_jo',
				userId: 'user_smoke_jo',
				name: 'Jo Smoke',
				email: 'jo@example.com',
				role: 'member',
				directoryManaged: false,
				createdAt: new Date(0).toISOString()
			},
			{
				id: 'membership_smoke_lee',
				userId: 'user_smoke_lee',
				name: 'Lee Smoke',
				email: 'lee@example.com',
				role: 'member',
				directoryManaged: false,
				createdAt: new Date(0).toISOString()
			}
		];
	}

	const runtime = createAuthRuntime(platform);
	const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
		organizationId: householdId,
		statuses: ['active'],
		limit: 100
	});

	return Promise.all(
		memberships.data.map(async (membership) => {
			try {
				const user = await runtime.workos.userManagement.getUser(membership.userId);
				return {
					id: membership.id,
					userId: membership.userId,
					name: displayUserName(user),
					email: user.email,
					role: membership.role.slug,
					directoryManaged: membership.directoryManaged,
					createdAt: membership.createdAt
				};
			} catch {
				return {
					id: membership.id,
					userId: membership.userId,
					name: membership.userId,
					email: '',
					role: membership.role.slug,
					directoryManaged: membership.directoryManaged,
					createdAt: membership.createdAt
				};
			}
		})
	);
};

export const countActiveHouseholdMembers = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<number> => Math.max(1, (await listHouseholdMembers(platform, householdId)).length);

export const selectActiveHouseholdId = (input: {
	cookieHouseholdId?: string | null;
	householdIds: string[];
}): string | null => {
	const accessibleHouseholdIds = new Set(input.householdIds);
	if (input.cookieHouseholdId && accessibleHouseholdIds.has(input.cookieHouseholdId)) {
		return input.cookieHouseholdId;
	}
	return input.householdIds[0] ?? null;
};

export const resolveActiveHouseholdId = async (input: {
	platform: App.Platform | undefined;
	cookies: Cookies;
	url: URL;
	session: { user: { id: string }; organizationId?: string | null };
	householdIds?: string[];
}): Promise<{ householdId: string | null; hasAnyHousehold: boolean }> => {
	const householdIds =
		input.householdIds ?? (await listUserHouseholdIds(input.platform, input.session.user.id));
	const householdId = selectActiveHouseholdId({
		cookieHouseholdId: readHouseholdCookie(input.cookies),
		householdIds
	});

	if (householdId) {
		await provisionAuthSession(input.platform, {
			user: input.session.user,
			organizationId: householdId
		});
		commitHouseholdCookie(input.cookies, householdId, input.url);
	}
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
		organizationId: organization.id,
		createdByUserId: input.userId
	});
	commitHouseholdCookie(input.cookies, organization.id, input.url);
	return organization;
};
