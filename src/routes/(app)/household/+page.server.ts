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
	SMOKE_HOUSEHOLD_ID,
	SMOKE_HOUSEHOLD_NAME,
	SMOKE_USER_ID,
	smokeAuthEnabled
} from '$lib/server/auth/smoke';
import type { Actions, PageServerLoad } from './$types';

const applianceOptions = [
	'oven',
	'stovetop',
	'microwave',
	'air_fryer',
	'slow_cooker',
	'rice_cooker',
	'blender',
	'food_processor',
	'grill'
] as const;

const weekStartDays = ['sunday', 'monday'] as const;
const defaultLocale = 'en-US';
const defaultTimezone = 'UTC';
const maxHouseholdNameLength = 120;
const inviteExpiryDays = [1, 7, 30] as const;

type Appliance = (typeof applianceOptions)[number];
type WeekStartDay = (typeof weekStartDays)[number];

const applianceLabels: Record<Appliance, string> = {
	oven: 'Oven',
	stovetop: 'Stovetop',
	microwave: 'Microwave',
	air_fryer: 'Air fryer',
	slow_cooker: 'Slow cooker',
	rice_cooker: 'Rice cooker',
	blender: 'Blender',
	food_processor: 'Food processor',
	grill: 'Grill'
};

const asWeekStartDay = (value: FormDataEntryValue | null): WeekStartDay => {
	const raw = typeof value === 'string' ? value : '';
	return weekStartDays.includes(raw as WeekStartDay) ? (raw as WeekStartDay) : 'monday';
};

const weekStartDay = (value?: number | null): WeekStartDay => (value === 0 ? 'sunday' : 'monday');
const weekStartValue = (value: WeekStartDay): number => (value === 'sunday' ? 0 : 1);

const localeFromForm = (value: FormDataEntryValue | null): string | undefined => {
	if (typeof value !== 'string') return;
	const locale = value.trim();
	if (!locale) return defaultLocale;
	try {
		return new Intl.Locale(locale).toString();
	} catch {
		return;
	}
};

const timezoneFromForm = (value: FormDataEntryValue | null): string | null | undefined => {
	if (typeof value !== 'string') return;
	const timezone = value.trim();
	if (!timezone) return null;
	if (timezone === defaultTimezone) return timezone;
	if (Intl.supportedValuesOf('timeZone').includes(timezone)) return timezone;
	return;
};

const numberFromForm = (value: FormDataEntryValue | null, fallback: number): number => {
	if (typeof value !== 'string') return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const timeFromForm = (value: FormDataEntryValue | null): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
};

const inviteExpiryFromForm = (value: FormDataEntryValue | null): string => {
	const days = Number.parseInt(String(value ?? '7'), 10);
	const safeDays = inviteExpiryDays.includes(days as (typeof inviteExpiryDays)[number]) ? days : 7;
	return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
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

type TaxonomyOption = { value: string; label: string; keywords?: string[] };

type TaxonomyOptions = {
	weightPresetOptions: TaxonomyOption[];
	volumePresetOptions: TaxonomyOption[];
	temperaturePresetOptions: TaxonomyOption[];
	baseUnitOptions: TaxonomyOption[];
	unitAliasOptions: TaxonomyOption[];
	measureUnitOptions: TaxonomyOption[];
	foodOptions: TaxonomyOption[];
	foodAliasOptions: TaxonomyOption[];
};

const emptyTaxonomyOptions = (): TaxonomyOptions => ({
	weightPresetOptions: [],
	volumePresetOptions: [],
	temperaturePresetOptions: [],
	baseUnitOptions: [],
	unitAliasOptions: [],
	measureUnitOptions: [],
	foodOptions: [],
	foodAliasOptions: []
});

const localeFallbacks = (locale: string): string[] => {
	try {
		const parsed = new Intl.Locale(locale);
		return [...new Set([parsed.toString(), parsed.language, defaultLocale])];
	} catch {
		return [defaultLocale];
	}
};

const labelFromId = (id: string): string => id.replaceAll('_', ' ');

type UnitOverrideInput = { baseUnit: string; preferredUnitAlias: string };
type IngredientOverrideInput = {
	baseFood: string;
	preferredFoodAlias: string;
	preferredMeasureUnit: string;
};
type DisplayOverrideRows = {
	preferredMassUnit?: string;
	preferredVolumeUnit?: string;
	preferredTemperatureUnit?: string;
	unitOverrides: Array<UnitOverrideInput & { id: string }>;
	ingredientOverrides: Array<IngredientOverrideInput & { id: string }>;
};

const parseJsonArray = <T>(value: FormDataEntryValue | null): T[] => {
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
};

const loadTaxonomyOptions = async (
	database: D1Database,
	locale: string
): Promise<TaxonomyOptions> => {
	const db = getDb(database);
	const [unitRows, unitAliasRows, foodRows, foodAliasRows] = await Promise.all([
		db.select().from(units),
		db.select().from(unitAliases).where(isNull(unitAliases.sourceDomain)),
		db.select().from(foods),
		db.select().from(foodAliases).where(isNull(foodAliases.sourceDomain))
	]);
	const localeRank = new Map(localeFallbacks(locale).map((value, index) => [value, index]));
	const aliasSort = <T extends { locale: string; defaultForLocale: boolean; alias: string }>(
		left: T,
		right: T
	) =>
		(localeRank.get(left.locale) ?? 100) - (localeRank.get(right.locale) ?? 100) ||
		Number(right.defaultForLocale) - Number(left.defaultForLocale) ||
		left.alias.localeCompare(right.alias);
	const aliasesByUnit = new Map<string, typeof unitAliasRows>();
	for (const alias of unitAliasRows) {
		aliasesByUnit.set(alias.unitId, [...(aliasesByUnit.get(alias.unitId) ?? []), alias]);
	}
	const aliasesByFood = new Map<string, typeof foodAliasRows>();
	for (const alias of foodAliasRows) {
		aliasesByFood.set(alias.foodId, [...(aliasesByFood.get(alias.foodId) ?? []), alias]);
	}
	const unitLabel = (unitId: string) =>
		[...(aliasesByUnit.get(unitId) ?? [])].sort(aliasSort)[0]?.alias ?? labelFromId(unitId);
	const foodLabel = (foodId: string) =>
		[...(aliasesByFood.get(foodId) ?? [])].sort(aliasSort)[0]?.alias ?? labelFromId(foodId);
	const uniqueByValue = (options: TaxonomyOption[]) => [
		...new Map(options.map((option) => [option.value, option])).values()
	];
	const unitOption = (unit: (typeof unitRows)[number]): TaxonomyOption => ({
		value: unit.id,
		label: unitLabel(unit.id),
		keywords: [unit.id, unit.baseUnitId, labelFromId(unit.id)]
	});
	const unitAliasOption = (alias: (typeof unitAliasRows)[number]): TaxonomyOption => ({
		value: alias.alias,
		label: alias.alias,
		keywords: [alias.unitId, alias.baseUnitId, alias.locale]
	});

	return {
		weightPresetOptions: uniqueByValue(
			unitAliasRows.filter((alias) => alias.baseUnitId === 'grams').map(unitAliasOption)
		),
		volumePresetOptions: uniqueByValue(
			unitAliasRows.filter((alias) => alias.baseUnitId === 'milliliters').map(unitAliasOption)
		),
		temperaturePresetOptions: uniqueByValue(
			unitAliasRows.filter((alias) => alias.baseUnitId === 'celsius').map(unitAliasOption)
		),
		baseUnitOptions: unitRows
			.filter((unit) => unit.id === unit.baseUnitId)
			.map(unitOption)
			.toSorted((left, right) => left.label.localeCompare(right.label)),
		unitAliasOptions: uniqueByValue(unitAliasRows.map(unitAliasOption)).toSorted((left, right) =>
			left.label.localeCompare(right.label)
		),
		measureUnitOptions: unitRows
			.map(unitOption)
			.toSorted((left, right) => left.label.localeCompare(right.label)),
		foodOptions: foodRows
			.map((food) => ({
				value: food.id,
				label: foodLabel(food.id),
				keywords: [food.id, labelFromId(food.id)]
			}))
			.toSorted((left, right) => left.label.localeCompare(right.label)),
		foodAliasOptions: uniqueByValue(
			foodAliasRows.map((alias) => ({
				value: alias.alias,
				label: alias.alias,
				keywords: [alias.foodId, alias.locale]
			}))
		).toSorted((left, right) => left.label.localeCompare(right.label))
	};
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

const unitByAlias = async (
	database: D1Database,
	alias: string,
	baseUnitId?: string
): Promise<{
	unitId: string;
	baseUnitId: string;
	aliasScope: 'global';
	aliasId: string;
} | null> => {
	const db = getDb(database);
	const rows = await db
		.select()
		.from(unitAliases)
		.where(
			and(
				eq(unitAliases.alias, alias),
				isNull(unitAliases.sourceDomain),
				baseUnitId ? eq(unitAliases.baseUnitId, baseUnitId) : undefined
			)
		)
		.limit(1);
	const row = rows[0];
	return row
		? { unitId: row.unitId, baseUnitId: row.baseUnitId, aliasScope: 'global', aliasId: row.id }
		: null;
};

const upsertUnitDisplayOverride = async ({
	database,
	householdId,
	locale,
	baseUnitId,
	preferredUnitAlias
}: {
	database: D1Database;
	householdId: string;
	locale: string;
	baseUnitId?: string;
	preferredUnitAlias: string;
}) => {
	const alias = preferredUnitAlias.trim();
	if (!alias) return;
	const db = getDb(database);
	const globalAlias = await unitByAlias(database, alias, baseUnitId);
	if (globalAlias) {
		await db
			.insert(householdUnitDisplayOverrides)
			.values({
				householdId,
				baseUnitId: globalAlias.baseUnitId,
				locale,
				preferredUnitId: globalAlias.unitId,
				preferredUnitAliasScope: globalAlias.aliasScope,
				preferredUnitAliasId: globalAlias.aliasId
			})
			.onConflictDoUpdate({
				target: [
					householdUnitDisplayOverrides.householdId,
					householdUnitDisplayOverrides.baseUnitId,
					householdUnitDisplayOverrides.locale
				],
				set: {
					preferredUnitId: globalAlias.unitId,
					preferredUnitAliasScope: globalAlias.aliasScope,
					preferredUnitAliasId: globalAlias.aliasId,
					updatedAt: new Date().toISOString()
				}
			});
		return;
	}
	if (!baseUnitId) return;
	const insertedAliases = await db
		.insert(unitHouseholdAliases)
		.values({ householdId, unitId: baseUnitId, baseUnitId, alias, locale })
		.returning({ id: unitHouseholdAliases.id });
	const aliasId = insertedAliases[0]?.id;
	if (!aliasId) return;
	await db
		.insert(householdUnitDisplayOverrides)
		.values({
			householdId,
			baseUnitId,
			locale,
			preferredUnitId: baseUnitId,
			preferredUnitAliasScope: 'household',
			preferredUnitAliasId: aliasId
		})
		.onConflictDoUpdate({
			target: [
				householdUnitDisplayOverrides.householdId,
				householdUnitDisplayOverrides.baseUnitId,
				householdUnitDisplayOverrides.locale
			],
			set: {
				preferredUnitId: baseUnitId,
				preferredUnitAliasScope: 'household',
				preferredUnitAliasId: aliasId,
				updatedAt: new Date().toISOString()
			}
		});
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

const displayUserName = (user: {
	name?: string | null;
	firstName?: string | null;
	lastName?: string | null;
	email: string;
}): string => {
	const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
	return user.name?.trim() || fullName || user.email.split('@')[0] || user.email;
};

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
		const profileUpdate: Partial<{
			defaultPlannedYield: number;
			locale: string;
			timezone: string | null;
			weekStartsOn: number;
			preferredDinnerTime: string | null;
		}> = {};
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

		if (form.has('defaultServings')) {
			profileUpdate.defaultPlannedYield = Math.min(
				24,
				Math.max(1, numberFromForm(form.get('defaultServings'), 1))
			);
		}
		if (form.has('locale')) {
			const locale = localeFromForm(form.get('locale'));
			if (!locale) return fail(400, { message: 'Locale is invalid.' });
			profileUpdate.locale = locale;
		}
		if (form.has('timezone')) {
			const timezone = timezoneFromForm(form.get('timezone'));
			if (timezone === undefined) return fail(400, { message: 'Timezone is invalid.' });
			profileUpdate.timezone = timezone;
		}
		if (form.has('weekStartsOn')) {
			profileUpdate.weekStartsOn = weekStartValue(asWeekStartDay(form.get('weekStartsOn')));
		}
		if (form.has('preferredDinnerTime')) {
			profileUpdate.preferredDinnerTime = timeFromForm(form.get('preferredDinnerTime'));
		}

		if (
			form.has('preferredMassUnit') ||
			form.has('preferredVolumeUnit') ||
			form.has('preferredTemperatureUnit') ||
			form.has('unitOverrides') ||
			form.has('ingredientOverrides')
		) {
			if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });
			const db = getDb(event.platform.env.DB);
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
				if (!row.baseFood) continue;
				const unitRows = row.preferredMeasureUnit
					? await db.select().from(units).where(eq(units.id, row.preferredMeasureUnit)).limit(1)
					: [];
				const measureUnit = unitRows[0];
				let preferredFoodAliasScope: 'global' | 'household' | null = null;
				let preferredFoodAliasId: string | null = null;
				const alias = row.preferredFoodAlias.trim();
				if (alias) {
					const globalAliases = await db
						.select()
						.from(foodAliases)
						.where(
							and(
								eq(foodAliases.foodId, row.baseFood),
								eq(foodAliases.alias, alias),
								isNull(foodAliases.sourceDomain)
							)
						)
						.limit(1);
					const globalAlias = globalAliases[0];
					if (globalAlias) {
						preferredFoodAliasScope = 'global';
						preferredFoodAliasId = globalAlias.id;
					} else {
						const insertedAliases = await db
							.insert(foodHouseholdAliases)
							.values({
								householdId,
								foodId: row.baseFood,
								alias,
								locale,
								defaultMeasureUnitId: measureUnit?.id,
								defaultMeasureBaseUnitId: measureUnit?.baseUnitId
							})
							.returning({ id: foodHouseholdAliases.id });
						preferredFoodAliasScope = 'household';
						preferredFoodAliasId = insertedAliases[0]?.id ?? null;
					}
				}
				updates.push(
					db
						.insert(householdFoodDisplayOverrides)
						.values({
							householdId,
							foodId: row.baseFood,
							locale,
							preferredFoodAliasScope,
							preferredFoodAliasId,
							preferredMeasureUnitId: measureUnit?.id,
							preferredMeasureBaseUnitId: measureUnit?.baseUnitId
						})
						.onConflictDoUpdate({
							target: [
								householdFoodDisplayOverrides.householdId,
								householdFoodDisplayOverrides.foodId,
								householdFoodDisplayOverrides.locale
							],
							set: {
								preferredFoodAliasScope,
								preferredFoodAliasId,
								preferredMeasureUnitId: measureUnit?.id,
								preferredMeasureBaseUnitId: measureUnit?.baseUnitId,
								updatedAt: new Date().toISOString()
							}
						})
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
