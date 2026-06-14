import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { foods, householdAppliances, households } from '$lib/server/db/schema';
import {
	canManageActiveHousehold,
	clearHouseholdCookie,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { applianceValues, type Appliance } from '$lib/domain/household/appliances';
import {
	asWeekStartDay,
	defaultLocale,
	defaultTimezone,
	inviteExpiryFromForm,
	localeFallbacks,
	localeFromForm,
	maxHouseholdNameLength,
	numberFromForm,
	weekStartDay
} from '$lib/domain/household/settings-parsing';
import { profileUpdateFromForm } from '$lib/domain/household/profile-settings';
import {
	createHouseholdInvite,
	deleteHouseholdInvite,
	householdRoleSlug,
	revokeHouseholdInvite,
	updateHouseholdInviteRole
} from '$lib/server/auth/household-invites';
import {
	emptyTaxonomyOptions,
	type TaxonomyOption,
	type TaxonomyOptions
} from '$lib/server/taxonomy/options';
import {
	upsertFoodDisplayOverride,
	upsertUnitDisplayOverride,
	type DisplayOverrideRows,
	type IngredientOverrideInput,
	type UnitOverrideInput
} from '$lib/server/taxonomy/display-overrides';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { loadHouseholdView } from '$lib/server/household/household-view';
import { membershipHasAdminRole } from '$lib/server/household/members';
import { deleteHouseholdCascade } from '$lib/server/household/delete-household';
import { SMOKE_HOUSEHOLD_ID, smokeAuthEnabled } from '$lib/server/auth/smoke';
import { smokeHouseholdView } from '$lib/server/household/smoke-household-view';
import type { Actions, PageServerLoad } from './$types';

const applianceOptions = applianceValues;

const parseJsonArray = <T>(value: FormDataEntryValue | null): T[] => {
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
};

const requireLoadedHousehold = async ({ locals, parent }: Parameters<PageServerLoad>[0]) => {
	if (!locals.session) redirect(302, '/auth/login');
	const layout = await parent();
	if (!layout.activeHouseholdId) redirect(302, '/onboarding');
	return { session: locals.session, householdId: layout.activeHouseholdId };
};

const requireActionHousehold = async (event: {
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

const requireManageHousehold = async (event: {
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

export const load: PageServerLoad = async (event) => {
	const { session, householdId } = await requireLoadedHousehold(event);

	if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
		return smokeHouseholdView(session.user.id);
	}

	if (!event.platform?.env.DB) redirect(302, '/onboarding');

	return loadHouseholdView({
		platform: event.platform,
		database: event.platform.env.DB,
		householdId,
		session,
		origin: event.url.origin
	});
};

export const actions: Actions = {
	createInvite: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		if (!event.platform?.env.DB) return fail(503, { message: 'Invite storage is not available.' });

		const form = await event.request.formData();
		const roleSlug = householdRoleSlug(form.get('role'));
		const maxUsesRaw = String(form.get('maxUses') ?? '').trim();
		const maxUses = maxUsesRaw ? Math.max(1, Math.min(100, Number.parseInt(maxUsesRaw, 10))) : null;
		const expiresAt = inviteExpiryFromForm(form.get('expiresInDays'));
		if (maxUsesRaw && !Number.isFinite(maxUses)) {
			return fail(400, { message: 'Max uses must be a number.' });
		}

		try {
			await createHouseholdInvite({
				database: event.platform.env.DB,
				householdId: managedHousehold.householdId,
				createdByUserId: managedHousehold.session.user.id,
				roleSlug,
				maxUses,
				expiresAt
			});
			return { message: 'Invite link created.' };
		} catch (cause) {
			console.error('Failed to create household invite', cause);
			return fail(500, { message: 'Could not create invite link.' });
		}
	},

	revokeInvite: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		if (!event.platform?.env.DB) return fail(503, { message: 'Invite storage is not available.' });

		const form = await event.request.formData();
		const inviteId = String(form.get('inviteId') ?? '').trim();
		if (!inviteId) return fail(400, { message: 'Choose an invite to revoke.' });
		await revokeHouseholdInvite({
			database: event.platform.env.DB,
			householdId: managedHousehold.householdId,
			inviteId
		});
		return { message: 'Invite revoked.' };
	},

	deleteInvite: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		if (!event.platform?.env.DB) return fail(503, { message: 'Invite storage is not available.' });

		const form = await event.request.formData();
		const inviteId = String(form.get('inviteId') ?? '').trim();
		if (!inviteId) return fail(400, { message: 'Choose an invite to delete.' });
		await deleteHouseholdInvite({
			database: event.platform.env.DB,
			householdId: managedHousehold.householdId,
			inviteId
		});
		return { message: 'Invite deleted.' };
	},

	updateInviteRole: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		if (!event.platform?.env.DB) return fail(503, { message: 'Invite storage is not available.' });

		const form = await event.request.formData();
		const inviteId = String(form.get('inviteId') ?? '').trim();
		if (!inviteId) return fail(400, { message: 'Choose an invite to update.' });
		await updateHouseholdInviteRole({
			database: event.platform.env.DB,
			householdId: managedHousehold.householdId,
			inviteId,
			roleSlug: householdRoleSlug(form.get('role'))
		});
		return { message: 'Invite role updated.' };
	},

	updateMemberRole: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId, session } = managedHousehold;
		const form = await event.request.formData();
		const membershipId = String(form.get('membershipId') ?? '').trim();
		const userId = String(form.get('userId') ?? '').trim();
		const roleSlug = householdRoleSlug(form.get('role'));
		if (!membershipId || !userId) return fail(400, { message: 'Choose a member to update.' });
		if (userId === session.user.id && roleSlug !== 'admin') {
			return fail(400, { message: 'You cannot remove your own manager access.' });
		}

		try {
			const runtime = createAuthRuntime(event.platform);
			const membership =
				await runtime.workos.userManagement.getOrganizationMembership(membershipId);
			if (membership.organizationId !== householdId || membership.userId !== userId) {
				return fail(404, { message: 'Household member not found.' });
			}
			if (membership.directoryManaged) {
				return fail(400, {
					message: 'Directory-managed member roles must be changed in the identity provider.'
				});
			}
			await runtime.workos.userManagement.updateOrganizationMembership(membershipId, { roleSlug });
			return { message: 'Member role updated.' };
		} catch (cause) {
			console.error('Failed to update household member role', cause);
			return fail(502, { message: 'Could not update member role.' });
		}
	},

	updateSettings: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId } = managedHousehold;
		const form = await event.request.formData();
		const parsedProfileUpdate = profileUpdateFromForm(form);
		if (!parsedProfileUpdate.ok) return fail(400, { message: parsedProfileUpdate.message });
		const profileUpdate = parsedProfileUpdate.update;
		const updates: Promise<unknown>[] = [];

		if (form.has('name')) {
			const name = String(form.get('name') ?? '').trim();
			if (!name) return fail(400, { message: 'Household name is required.' });
			if (name.length > maxHouseholdNameLength) {
				return fail(400, { message: 'Household name is too long.' });
			}
			updates.push(
				createAuthRuntime(event.platform).workos.organizations.updateOrganization({
					organization: householdId,
					name
				})
			);
		}

		if (
			form.has('preferredMassUnit') ||
			form.has('preferredVolumeUnit') ||
			form.has('preferredTemperatureUnit') ||
			form.has('unitOverrides') ||
			form.has('ingredientOverrides')
		) {
			if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });
			const locale = localeFromForm(form.get('overrideLocale')) ?? defaultLocale;
			const preferredMassUnit = String(form.get('preferredMassUnit') ?? '').trim();
			const preferredVolumeUnit = String(form.get('preferredVolumeUnit') ?? '').trim();
			const preferredTemperatureUnit = String(form.get('preferredTemperatureUnit') ?? '').trim();
			if (preferredMassUnit) {
				updates.push(
					upsertUnitDisplayOverride({
						database: event.platform.env.DB,
						householdId,
						locale,
						baseUnitId: 'grams',
						preferredUnitAlias: preferredMassUnit
					})
				);
			}
			if (preferredVolumeUnit) {
				updates.push(
					upsertUnitDisplayOverride({
						database: event.platform.env.DB,
						householdId,
						locale,
						baseUnitId: 'milliliters',
						preferredUnitAlias: preferredVolumeUnit
					})
				);
			}
			if (preferredTemperatureUnit) {
				updates.push(
					upsertUnitDisplayOverride({
						database: event.platform.env.DB,
						householdId,
						locale,
						baseUnitId: 'celsius',
						preferredUnitAlias: preferredTemperatureUnit
					})
				);
			}
			for (const row of parseJsonArray<UnitOverrideInput>(form.get('unitOverrides'))) {
				if (!row.baseUnit || !row.preferredUnitAlias) continue;
				updates.push(
					upsertUnitDisplayOverride({
						database: event.platform.env.DB,
						householdId,
						locale,
						baseUnitId: row.baseUnit,
						preferredUnitAlias: row.preferredUnitAlias
					})
				);
			}
			for (const row of parseJsonArray<IngredientOverrideInput>(form.get('ingredientOverrides'))) {
				updates.push(
					upsertFoodDisplayOverride({ database: event.platform.env.DB, householdId, locale, row })
				);
			}
		}

		if (Object.keys(profileUpdate).length > 0) {
			if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });
			updates.push(
				getDb(event.platform.env.DB)
					.insert(households)
					.values({
						householdId,
						defaultPlannedYield: profileUpdate.defaultPlannedYield ?? 1,
						locale: profileUpdate.locale ?? defaultLocale,
						timezone: profileUpdate.timezone ?? defaultTimezone,
						weekStartsOn: profileUpdate.weekStartsOn ?? 1,
						preferredDinnerTime: profileUpdate.preferredDinnerTime ?? null
					})
					.onConflictDoUpdate({
						target: households.householdId,
						set: { ...profileUpdate, updatedAt: new Date().toISOString() }
					})
			);
		}

		if (updates.length === 0) return { message: 'No changes.' };

		try {
			await Promise.all(updates);
			return { message: 'Household saved.' };
		} catch (cause) {
			console.error('Failed to update household settings', cause);
			return fail(502, { message: 'Could not update household settings.' });
		}
	},
	updateAppliances: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId } = managedHousehold;
		if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });

		const form = await event.request.formData();
		const db = getDb(event.platform.env.DB);
		const now = new Date().toISOString();

		try {
			let changedCount = 0;
			for (const appliance of applianceOptions) {
				if (!form.has(`available:${appliance}`) && !form.has(`notes:${appliance}`)) continue;
				changedCount += 1;
				const available = form.get(`available:${appliance}`) === 'on';
				const notes = String(form.get(`notes:${appliance}`) ?? '').trim() || null;
				await db
					.insert(householdAppliances)
					.values({ householdId, appliance, available, notes })
					.onConflictDoUpdate({
						target: [householdAppliances.householdId, householdAppliances.appliance],
						set: { available, notes, updatedAt: now }
					});
			}
			return { message: changedCount > 0 ? 'Appliances saved.' : 'No changes.' };
		} catch (cause) {
			console.error('Failed to update household appliances', cause);
			return fail(502, { message: 'Could not update appliances.' });
		}
	},
	leaveHousehold: async (event) => {
		const household = await requireActionHousehold(event);
		const { session, householdId } = household;
		if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
			return fail(400, { message: 'Smoke household cannot be left.' });
		}

		try {
			const runtime = createAuthRuntime(event.platform);
			const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
				organizationId: householdId,
				statuses: ['active'],
				limit: 100
			});
			const currentMembership = memberships.data.find(
				(membership) => membership.userId === session.user.id
			);
			if (!currentMembership) return fail(404, { message: 'Household member not found.' });
			if (currentMembership.directoryManaged) {
				return fail(400, {
					message: 'Directory-managed members must leave through the identity provider.'
				});
			}

			const adminCount = memberships.data.filter(membershipHasAdminRole).length;
			if (membershipHasAdminRole(currentMembership) && adminCount <= 1) {
				return fail(400, {
					message: 'You are the last manager. Add another manager or delete the household instead.'
				});
			}

			await runtime.workos.userManagement.deleteOrganizationMembership(currentMembership.id);
			clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to leave household', cause);
			return fail(502, { message: 'Could not leave household.' });
		}

		redirect(303, '/onboarding');
	},

	removeMember: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { session, householdId } = managedHousehold;
		const form = await event.request.formData();
		const membershipId = String(form.get('membershipId') ?? '');
		const userId = String(form.get('userId') ?? '');
		if (!membershipId || !userId) return fail(400, { message: 'Choose a member to remove.' });
		if (userId === session.user.id) return fail(400, { message: 'You cannot remove yourself.' });

		try {
			const runtime = createAuthRuntime(event.platform);
			const membership =
				await runtime.workos.userManagement.getOrganizationMembership(membershipId);
			if (membership.organizationId !== householdId || membership.userId !== userId) {
				return fail(404, { message: 'Household member not found.' });
			}
			if (membership.directoryManaged) {
				return fail(400, {
					message: 'Directory-managed members must be removed in the identity provider.'
				});
			}
			await runtime.workos.userManagement.deleteOrganizationMembership(membershipId);
			return { message: 'Member removed.' };
		} catch (cause) {
			console.error('Failed to remove household member', cause);
			return fail(502, { message: 'Could not remove member.' });
		}
	},
	deleteHousehold: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId } = managedHousehold;
		if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
			return fail(400, { message: 'Smoke household cannot be deleted.' });
		}
		if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });

		try {
			await deleteHouseholdCascade({
				database: event.platform.env.DB,
				platform: event.platform,
				householdId
			});
			clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to delete household', cause);
			return fail(502, { message: 'Could not delete household.' });
		}

		redirect(303, '/onboarding');
	}
};
