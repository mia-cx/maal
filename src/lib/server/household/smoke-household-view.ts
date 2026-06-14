import { applianceLabels, applianceValues } from '$lib/domain/household/appliances';
import { defaultLocale, defaultTimezone } from '$lib/domain/household/settings-parsing';
import { SMOKE_HOUSEHOLD_ID, SMOKE_HOUSEHOLD_NAME, SMOKE_USER_ID } from '$lib/server/auth/smoke';
import { emptyTaxonomyOptions } from '$lib/server/taxonomy/options';

export const smokeHouseholdView = (currentUserId: string) => ({
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
	appliances: applianceValues.map((appliance) => ({
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
	currentUserId,
	canManageHousehold: true,
	canLeaveHousehold: false,
	leaveHouseholdDisabledReason:
		'You are the last manager. Add another manager or delete the household instead.',
	invites: [],
	taxonomyOptions: emptyTaxonomyOptions(),
	displayOverrideRows: { unitOverrides: [], ingredientOverrides: [] }
});
