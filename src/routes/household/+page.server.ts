import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	householdAppliances,
	householdMealApplianceRequirements,
	householdMealIngredients,
	householdMealInstructions,
	householdMealNutrition,
	householdMeals,
	householdProfiles,
	mealCheckIns,
	pantryStaples
} from '$lib/server/db/schema';
import {
	canManageActiveHousehold,
	clearHouseholdCookie,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
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
const massUnits = ['g', 'kg', 'oz', 'lb'] as const;
const volumeUnits = ['ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz'] as const;
const maxHouseholdNameLength = 120;

type Appliance = (typeof applianceOptions)[number];
type WeekStartDay = (typeof weekStartDays)[number];
type MassUnit = (typeof massUnits)[number];
type VolumeUnit = (typeof volumeUnits)[number];

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

const asMassUnit = (value: FormDataEntryValue | null): MassUnit => {
	const raw = typeof value === 'string' ? value : '';
	return massUnits.includes(raw as MassUnit) ? (raw as MassUnit) : 'g';
};

const asVolumeUnit = (value: FormDataEntryValue | null): VolumeUnit => {
	const raw = typeof value === 'string' ? value : '';
	return volumeUnits.includes(raw as VolumeUnit) ? (raw as VolumeUnit) : 'ml';
};

const normalizedIngredientKey = (value: string): string =>
	value
		.toLowerCase()
		.replace(/\([^)]*\)/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const parseIngredientUnitOverrides = (value: FormDataEntryValue | null): Record<string, string> => {
	if (typeof value !== 'string') return {};
	const overrides: Record<string, string> = {};
	for (const line of value.split('\n')) {
		const [rawName, ...rawUnitParts] = line.split(':');
		const name = normalizedIngredientKey(rawName ?? '');
		const unit = rawUnitParts.join(':').trim().toLowerCase();
		if (!name || !unit) continue;
		if (massUnits.includes(unit as MassUnit) || volumeUnits.includes(unit as VolumeUnit)) {
			overrides[name] = unit;
		}
	}
	return overrides;
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

const loadMembers = async (platform: App.Platform | undefined, householdId: string) => {
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
					name: user.name ?? user.email,
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
				stripeCustomerId: null,
				metadata: {}
			},
			profile: {
				defaultServings: 4,
				weekStartsOn: 'monday' as const,
				preferredMassUnit: 'g' as const,
				preferredVolumeUnit: 'ml' as const,
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
					role: 'admin',
					directoryManaged: false,
					createdAt: null
				}
			],
			currentUserId: session.user.id,
			canManageHousehold: true
		};
	}

	if (!event.platform?.env.DB) redirect(302, '/onboarding');

	const runtime = createAuthRuntime(event.platform);
	const [organization, profileRows, applianceRows, members, hasManagePermission] =
		await Promise.all([
			runtime.workos.organizations.getOrganization(householdId),
			getDb(event.platform.env.DB)
				.select()
				.from(householdProfiles)
				.where(eq(householdProfiles.householdId, householdId))
				.limit(1),
			getDb(event.platform.env.DB)
				.select()
				.from(householdAppliances)
				.where(eq(householdAppliances.householdId, householdId)),
			loadMembers(event.platform, householdId),
			canManageActiveHousehold(event.platform, session, householdId)
		]);

	const profile = profileRows[0] ?? {
		defaultServings: 1,
		weekStartsOn: 'monday' as const,
		preferredMassUnit: 'g' as const,
		preferredVolumeUnit: 'ml' as const,
		ingredientUnitOverrides: {},
		preferredDinnerTime: null
	};
	const applianceByName = new Map(applianceRows.map((row) => [row.appliance, row]));

	return {
		household: {
			id: organization.id,
			name: organization.name,
			createdAt: organization.createdAt,
			updatedAt: organization.updatedAt,
			externalId: organization.externalId,
			stripeCustomerId: organization.stripeCustomerId ?? null,
			metadata: organization.metadata
		},
		profile: {
			defaultServings: profile.defaultServings,
			weekStartsOn: profile.weekStartsOn,
			preferredMassUnit: profile.preferredMassUnit,
			preferredVolumeUnit: profile.preferredVolumeUnit,
			ingredientUnitOverrides: profile.ingredientUnitOverrides,
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
		canManageHousehold: hasManagePermission
	};
};

export const actions: Actions = {
	updateSettings: async (event) => {
		const managedHousehold = await requireManageHousehold(event);
		if ('status' in managedHousehold) return managedHousehold;
		const { householdId } = managedHousehold;
		const form = await event.request.formData();
		const profileUpdate: Partial<{
			defaultServings: number;
			weekStartsOn: WeekStartDay;
			preferredMassUnit: MassUnit;
			preferredVolumeUnit: VolumeUnit;
			ingredientUnitOverrides: Record<string, string>;
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
			profileUpdate.defaultServings = Math.min(
				24,
				Math.max(1, numberFromForm(form.get('defaultServings'), 1))
			);
		}
		if (form.has('weekStartsOn'))
			profileUpdate.weekStartsOn = asWeekStartDay(form.get('weekStartsOn'));
		if (form.has('preferredMassUnit')) {
			profileUpdate.preferredMassUnit = asMassUnit(form.get('preferredMassUnit'));
		}
		if (form.has('preferredVolumeUnit')) {
			profileUpdate.preferredVolumeUnit = asVolumeUnit(form.get('preferredVolumeUnit'));
		}
		if (form.has('ingredientUnitOverrides')) {
			profileUpdate.ingredientUnitOverrides = parseIngredientUnitOverrides(
				form.get('ingredientUnitOverrides')
			);
		}
		if (form.has('preferredDinnerTime')) {
			profileUpdate.preferredDinnerTime = timeFromForm(form.get('preferredDinnerTime'));
		}

		if (Object.keys(profileUpdate).length > 0) {
			if (!event.platform?.env.DB) return fail(500, { message: 'Database is not available.' });
			updates.push(
				getDb(event.platform.env.DB)
					.insert(householdProfiles)
					.values({
						householdId,
						defaultServings: profileUpdate.defaultServings ?? 1,
						weekStartsOn: profileUpdate.weekStartsOn ?? 'monday',
						preferredMassUnit: profileUpdate.preferredMassUnit ?? 'g',
						preferredVolumeUnit: profileUpdate.preferredVolumeUnit ?? 'ml',
						ingredientUnitOverrides: profileUpdate.ingredientUnitOverrides ?? {},
						preferredDinnerTime: profileUpdate.preferredDinnerTime ?? null
					})
					.onConflictDoUpdate({
						target: householdProfiles.householdId,
						set: { ...profileUpdate, updatedAt: new Date() }
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
		const now = new Date();

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

			await createAuthRuntime(event.platform).workos.organizations.deleteOrganization(householdId);

			if (mealIds.length > 0) {
				await db.delete(mealCheckIns).where(inArray(mealCheckIns.householdMealId, mealIds));
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
					.delete(householdMealNutrition)
					.where(inArray(householdMealNutrition.householdMealId, mealIds));
			}

			await db.delete(householdMeals).where(eq(householdMeals.householdId, householdId));
			await db.delete(householdAppliances).where(eq(householdAppliances.householdId, householdId));
			await db.delete(householdProfiles).where(eq(householdProfiles.householdId, householdId));
			await db.delete(pantryStaples).where(eq(pantryStaples.householdId, householdId));
			clearHouseholdCookie(event.cookies);
		} catch (cause) {
			console.error('Failed to delete household', cause);
			return fail(502, { message: 'Could not delete household.' });
		}

		redirect(303, '/onboarding');
	}
};
