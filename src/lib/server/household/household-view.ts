import { eq } from 'drizzle-orm';
import { applianceLabels, applianceValues } from '$lib/domain/household/appliances';
import {
	defaultLocale,
	defaultTimezone,
	weekStartDay
} from '$lib/domain/household/settings-parsing';
import type { AuthSession } from '$lib/server/auth/session';
import { canManageActiveHousehold } from '$lib/server/auth/household';
import {
	householdRoleSlug,
	inviteUsable,
	listHouseholdInvites
} from '$lib/server/auth/household-invites';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { getDb } from '$lib/server/db';
import { householdAppliances, households } from '$lib/server/db/schema';
import { loadDisplayOverrideRows } from '$lib/server/taxonomy/display-overrides';
import { loadTaxonomyOptions } from '$lib/server/taxonomy/options';
import { canCurrentUserLeaveHousehold, loadMembers } from '$lib/server/household/members';

export const loadHouseholdView = async ({
	platform,
	database,
	householdId,
	session,
	origin
}: {
	platform: App.Platform;
	database: D1Database;
	householdId: string;
	session: AuthSession;
	origin: string;
}) => {
	const runtime = createAuthRuntime(platform);
	const [organization, householdRows, applianceRows, members, hasManagePermission, invites] =
		await Promise.all([
			runtime.workos.organizations.getOrganization(householdId),
			getDb(database)
				.select()
				.from(households)
				.where(eq(households.householdId, householdId))
				.limit(1),
			getDb(database)
				.select()
				.from(householdAppliances)
				.where(eq(householdAppliances.householdId, householdId)),
			loadMembers(platform, householdId),
			canManageActiveHousehold(platform, session, householdId),
			listHouseholdInvites(database, householdId)
		]);

	const profile = householdRows[0] ?? {
		defaultPlannedYield: 1,
		locale: defaultLocale,
		timezone: defaultTimezone,
		weekStartsOn: 1,
		preferredDinnerTime: null
	};
	const applianceByName = new Map(applianceRows.map((row) => [row.appliance, row]));
	const locale = profile.locale ?? defaultLocale;
	const [displayOverrideRows, taxonomyOptions] = await Promise.all([
		loadDisplayOverrideRows(database, householdId, locale),
		loadTaxonomyOptions(database, locale)
	]);

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
		appliances: applianceValues.map((appliance) => {
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
			url: `${origin}/invite/${invite.code}`,
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
