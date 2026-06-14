import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	billingSubscriptions,
	foodAliases,
	foodHouseholdAliases,
	foodHouseholdEntries,
	foods,
	householdAppliances,
	householdFoodDisplayOverrides,
	householdInvites,
	householdMealApplianceRequirements,
	householdMealClassifications,
	householdMealIngredients,
	householdMealInstructionEvents,
	householdMealInstructions,
	householdMealMedia,
	householdMealNutritionFacts,
	householdMeals,
	households,
	householdMealUserRecipes,
	householdUnitDisplayOverrides,
	unitAliases,
	unitHouseholdAliases,
	unitHouseholdEntries,
	units,
	userRecipes
} from '$lib/server/db/schema';
import {
	canManageActiveHousehold,
	clearHouseholdCookie,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { applianceLabels, applianceValues, type Appliance } from '$lib/domain/household/appliances';
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
	inviteUsable,
	listHouseholdInvites,
	revokeHouseholdInvite,
	updateHouseholdInviteRole
} from '$lib/server/auth/household-invites';
import { createAuthRuntime } from '$lib/server/auth/workos';
import {
	emptyTaxonomyOptions,
	loadTaxonomyOptions,
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
import { displayUserName } from '$lib/server/auth/user-display';
import {
	SMOKE_HOUSEHOLD_ID,
	SMOKE_HOUSEHOLD_NAME,
	SMOKE_USER_ID,
	smokeAuthEnabled
} from '$lib/server/auth/smoke';
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

type HouseholdMemberRow = {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: 'admin' | 'member' | 'child';
	directoryManaged: boolean;
	createdAt: string | null;
};

const loadDisplayOverrideRows = async (
	database: D1Database,
	householdId: string,
	locale: string
): Promise<DisplayOverrideRows> => {
	const db = getDb(database);
	const [
		unitOverrideRows,
		ingredientOverrideRows,
		globalUnitAliases,
		householdUnitAliases,
		globalFoodAliases,
		householdFoodAliases
	] = await Promise.all([
		db
			.select()
			.from(householdUnitDisplayOverrides)
			.where(
				and(
					eq(householdUnitDisplayOverrides.householdId, householdId),
					eq(householdUnitDisplayOverrides.locale, locale)
				)
			),
		db
			.select()
			.from(householdFoodDisplayOverrides)
			.where(
				and(
					eq(householdFoodDisplayOverrides.householdId, householdId),
					eq(householdFoodDisplayOverrides.locale, locale)
				)
			),
		db.select().from(unitAliases),
		db.select().from(unitHouseholdAliases).where(eq(unitHouseholdAliases.householdId, householdId)),
		db.select().from(foodAliases),
		db.select().from(foodHouseholdAliases).where(eq(foodHouseholdAliases.householdId, householdId))
	]);
	const globalUnitAliasById = new Map(globalUnitAliases.map((alias) => [alias.id, alias.alias]));
	const householdUnitAliasById = new Map(
		householdUnitAliases.map((alias) => [alias.id, alias.alias])
	);
	const globalFoodAliasById = new Map(globalFoodAliases.map((alias) => [alias.id, alias.alias]));
	const householdFoodAliasById = new Map(
		householdFoodAliases.map((alias) => [alias.id, alias.alias])
	);
	const unitAliasFor = (scope: string | null, id: string | null) => {
		if (!id) return '';
		return scope === 'household'
			? (householdUnitAliasById.get(id) ?? '')
			: (globalUnitAliasById.get(id) ?? '');
	};
	const foodAliasFor = (scope: string | null, id: string | null) => {
		if (!id) return '';
		return scope === 'household'
			? (householdFoodAliasById.get(id) ?? '')
			: (globalFoodAliasById.get(id) ?? '');
	};
	const result: DisplayOverrideRows = { unitOverrides: [], ingredientOverrides: [] };
	for (const row of unitOverrideRows) {
		const alias = unitAliasFor(row.preferredUnitAliasScope, row.preferredUnitAliasId);
		if (!alias) continue;
		if (row.baseUnitId === 'grams') result.preferredMassUnit = alias;
		else if (row.baseUnitId === 'milliliters') result.preferredVolumeUnit = alias;
		else if (row.baseUnitId === 'celsius') result.preferredTemperatureUnit = alias;
		else
			result.unitOverrides.push({
				id: row.id,
				baseUnit: row.baseUnitId,
				preferredUnitAlias: alias
			});
	}
	for (const row of ingredientOverrideRows) {
		result.ingredientOverrides.push({
			id: row.id,
			baseFood: row.foodId,
			preferredFoodAlias: foodAliasFor(row.preferredFoodAliasScope, row.preferredFoodAliasId),
			preferredMeasureUnit: row.preferredMeasureUnitId ?? ''
		});
	}
	return result;
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

const canCurrentUserLeaveHousehold = (
	members: HouseholdMemberRow[],
	currentUserId: string
): { canLeave: boolean; reason: string | null } => {
	const currentMember = members.find((member) => member.userId === currentUserId);
	if (!currentMember) return { canLeave: false, reason: 'You are not a member of this household.' };
	const adminCount = members.filter((member) => member.role === 'admin').length;
	if (currentMember.role === 'admin' && adminCount <= 1) {
		return {
			canLeave: false,
			reason: 'You are the last manager. Add another manager or delete the household instead.'
		};
	}
	return { canLeave: true, reason: null };
};

const membershipHasAdminRole = (membership: {
	role: { slug: string };
	roles?: Array<{ slug: string }> | null;
}): boolean =>
	membership.role.slug === 'admin' ||
	Boolean(membership.roles?.some((role) => role.slug === 'admin'));

const loadMembers = async (
	platform: App.Platform | undefined,
	householdId: string
): Promise<HouseholdMemberRow[]> => {
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
					role: householdRoleSlug(membership.role.slug),
					directoryManaged: membership.directoryManaged,
					createdAt: membership.createdAt
				};
			} catch {
				return {
					id: membership.id,
					userId: membership.userId,
					name: membership.userId,
					email: '',
					role: householdRoleSlug(membership.role.slug),
					directoryManaged: membership.directoryManaged,
					createdAt: membership.createdAt
				};
			}
		})
	);
};

export const load: PageServerLoad = async (event) => {
	const { session, householdId } = await requireLoadedHousehold(event);

	if (smokeAuthEnabled(event.platform) && householdId === SMOKE_HOUSEHOLD_ID) {
		return {
			household: {
				id: SMOKE_HOUSEHOLD_ID,
				name: SMOKE_HOUSEHOLD_NAME,
				createdAt: null,
				updatedAt: null,
				externalId: null,
				stripeCustomerId: null
			},
			profile: {
				defaultServings: 4,
				locale: defaultLocale,
				timezone: defaultTimezone,
				weekStartsOn: 'monday' as const,
				preferredMassUnit: 'g' as const,
				preferredVolumeUnit: 'ml' as const,
				preferredTemperatureUnit: '°C' as const,
				ingredientUnitOverrides: {},
				preferredDinnerTime: '18:30'
			},
			appliances: applianceOptions.map((appliance) => ({
				appliance,
				label: applianceLabels[appliance],
				available: true,
				notes: ''
			})),
			members: [
				{
					id: 'membership_smoke_maal',
					userId: SMOKE_USER_ID,
					name: 'Smoke User',
					email: 'smoke@maal.test',
					role: 'admin' as const,
					directoryManaged: false,
					createdAt: null
				}
			],
			currentUserId: session.user.id,
			canManageHousehold: true,
			canLeaveHousehold: false,
			leaveHouseholdDisabledReason:
				'You are the last manager. Add another manager or delete the household instead.',
			invites: [],
			taxonomyOptions: emptyTaxonomyOptions(),
			displayOverrideRows: { unitOverrides: [], ingredientOverrides: [] }
		};
	}

	if (!event.platform?.env.DB) redirect(302, '/onboarding');

	const runtime = createAuthRuntime(event.platform);
	const [organization, householdRows, applianceRows, members, hasManagePermission, invites] =
		await Promise.all([
			runtime.workos.organizations.getOrganization(householdId),
			getDb(event.platform.env.DB)
				.select()
				.from(households)
				.where(eq(households.householdId, householdId))
				.limit(1),
			getDb(event.platform.env.DB)
				.select()
				.from(householdAppliances)
				.where(eq(householdAppliances.householdId, householdId)),
			loadMembers(event.platform, householdId),
			canManageActiveHousehold(event.platform, session, householdId),
			listHouseholdInvites(event.platform.env.DB, householdId)
		]);

	const profile = householdRows[0] ?? {
		defaultPlannedYield: 1,
		locale: defaultLocale,
		timezone: defaultTimezone,
		weekStartsOn: 1,
		preferredDinnerTime: null
	};
	const applianceByName = new Map(applianceRows.map((row) => [row.appliance, row]));
	const displayOverrideRows = await loadDisplayOverrideRows(
		event.platform.env.DB,
		householdId,
		profile.locale ?? defaultLocale
	);
	const taxonomyOptions = await loadTaxonomyOptions(
		event.platform.env.DB,
		profile.locale ?? defaultLocale
	);

	const leaveState = canCurrentUserLeaveHousehold(members, session.user.id);

	return {
		household: {
			id: organization.id,
			name: organization.name,
			createdAt: organization.createdAt,
			updatedAt: organization.updatedAt,
			externalId: organization.externalId,
			stripeCustomerId: organization.stripeCustomerId ?? null
		},
		profile: {
			defaultServings: profile.defaultPlannedYield,
			locale: profile.locale ?? defaultLocale,
			timezone: profile.timezone ?? defaultTimezone,
			weekStartsOn: weekStartDay(profile.weekStartsOn),
			preferredMassUnit: displayOverrideRows.preferredMassUnit ?? 'g',
			preferredVolumeUnit: displayOverrideRows.preferredVolumeUnit ?? 'ml',
			preferredTemperatureUnit:
				displayOverrideRows.preferredTemperatureUnit ??
				taxonomyOptions.temperaturePresetOptions[0]?.value ??
				'',
			ingredientUnitOverrides: {},
			preferredDinnerTime: profile.preferredDinnerTime
		},
		appliances: applianceOptions.map((appliance) => {
			const row = applianceByName.get(appliance);
			return {
				appliance,
				label: applianceLabels[appliance],
				available: row?.available ?? false,
				notes: row?.notes ?? ''
			};
		}),
		members,
		currentUserId: session.user.id,
		canManageHousehold: hasManagePermission,
		canLeaveHousehold: leaveState.canLeave,
		leaveHouseholdDisabledReason: leaveState.reason,
		invites: invites.map((invite) => ({
			id: invite.id,
			code: invite.code,
			url: `${event.url.origin}/invite/${invite.code}`,
			role: householdRoleSlug(invite.roleSlug),
			maxUses: invite.maxUses,
			usesCount: invite.usesCount,
			expiresAt: invite.expiresAt,
			revokedAt: invite.revokedAt,
			createdAt: invite.createdAt,
			usable: inviteUsable(invite)
		})),
		taxonomyOptions,
		displayOverrideRows
	};
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
			const db = getDb(event.platform.env.DB);
			const mealRows = await db
				.select({ id: householdMeals.id })
				.from(householdMeals)
				.where(eq(householdMeals.householdId, householdId));
			const mealIds = mealRows.map((meal) => meal.id);
			const instructionRows = mealIds.length
				? await db
						.select({ id: householdMealInstructions.id })
						.from(householdMealInstructions)
						.where(inArray(householdMealInstructions.householdMealId, mealIds))
				: [];
			const instructionIds = instructionRows.map((instruction) => instruction.id);

			await createAuthRuntime(event.platform).workos.organizations.deleteOrganization(householdId);

			if (instructionIds.length > 0) {
				await db
					.delete(householdMealInstructionEvents)
					.where(
						inArray(householdMealInstructionEvents.householdMealInstructionId, instructionIds)
					);
			}

			if (mealIds.length > 0) {
				await db
					.delete(householdMealUserRecipes)
					.where(inArray(householdMealUserRecipes.householdMealId, mealIds));
				await db
					.delete(householdMealIngredients)
					.where(inArray(householdMealIngredients.householdMealId, mealIds));
				await db
					.delete(householdMealApplianceRequirements)
					.where(inArray(householdMealApplianceRequirements.householdMealId, mealIds));
				await db
					.delete(householdMealInstructions)
					.where(inArray(householdMealInstructions.householdMealId, mealIds));
				await db
					.delete(householdMealClassifications)
					.where(inArray(householdMealClassifications.householdMealId, mealIds));
				await db
					.delete(householdMealMedia)
					.where(inArray(householdMealMedia.householdMealId, mealIds));
				await db
					.delete(householdMealNutritionFacts)
					.where(inArray(householdMealNutritionFacts.householdMealId, mealIds));
			}

			await db.delete(householdMeals).where(eq(householdMeals.householdId, householdId));
			await db
				.delete(billingSubscriptions)
				.where(eq(billingSubscriptions.householdId, householdId));
			await db.delete(householdInvites).where(eq(householdInvites.householdId, householdId));
			await db
				.delete(householdFoodDisplayOverrides)
				.where(eq(householdFoodDisplayOverrides.householdId, householdId));
			await db
				.delete(householdUnitDisplayOverrides)
				.where(eq(householdUnitDisplayOverrides.householdId, householdId));
			await db
				.delete(foodHouseholdAliases)
				.where(eq(foodHouseholdAliases.householdId, householdId));
			await db
				.delete(foodHouseholdEntries)
				.where(eq(foodHouseholdEntries.householdId, householdId));
			await db
				.delete(unitHouseholdAliases)
				.where(eq(unitHouseholdAliases.householdId, householdId));
			await db
				.delete(unitHouseholdEntries)
				.where(eq(unitHouseholdEntries.householdId, householdId));
			await db.delete(householdAppliances).where(eq(householdAppliances.householdId, householdId));
			await db
				.update(userRecipes)
				.set({ savedFromHouseholdId: null })
				.where(eq(userRecipes.savedFromHouseholdId, householdId));
			await db.delete(households).where(eq(households.householdId, householdId));
			clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to delete household', cause);
			return fail(502, { message: 'Could not delete household.' });
		}

		redirect(303, '/onboarding');
	}
};
