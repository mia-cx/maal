import { Schema } from 'effect';

import {
	DomainIdSchema,
	LocaleSchema,
	LocalTimeSchema,
	MutableAggregateFields,
	TimeZoneSchema,
	UtcInstantSchema
} from '$lib/domain/contracts/primitives.js';

export const householdRoleValues = ['admin', 'member', 'child'] as const;
export const HouseholdRoleSchema = Schema.Literal(...householdRoleValues);
export type HouseholdRole = typeof HouseholdRoleSchema.Type;

export const householdPermissionValues = [
	'households:write',
	'recipes:read',
	'recipes:write',
	'meals:read',
	'meals:write'
] as const;
export const HouseholdPermissionSchema = Schema.Literal(...householdPermissionValues);
export type HouseholdPermission = typeof HouseholdPermissionSchema.Type;

export const ProfileAuthStateSchema = Schema.Literal(
	'authenticated',
	'stale',
	'reauthRequired',
	'signedOut'
);
export type ProfileAuthState = typeof ProfileAuthStateSchema.Type;

export const ProfileLockPolicySchema = Schema.Literal('none', 'pin');
export type ProfileLockPolicy = typeof ProfileLockPolicySchema.Type;

export const ProfileSchema = Schema.Struct({
	profileId: DomainIdSchema,
	workosUserId: Schema.String,
	displayName: Schema.String,
	email: Schema.NullOr(Schema.String),
	profilePictureUrl: Schema.NullOr(Schema.String),
	locale: LocaleSchema,
	timezone: Schema.NullOr(TimeZoneSchema),
	pinSalt: Schema.NullOr(Schema.String),
	pinVerifier: Schema.NullOr(Schema.String),
	lockPolicy: ProfileLockPolicySchema,
	lastUsedAt: UtcInstantSchema,
	authState: ProfileAuthStateSchema
});
export type Profile = typeof ProfileSchema.Type;

export const HouseholdDeletionStateSchema = Schema.Literal(
	'active',
	'deletionPending',
	'recoverable',
	'purged'
);
export type HouseholdDeletionState = typeof HouseholdDeletionStateSchema.Type;

export const HouseholdSchema = Schema.Struct({
	...MutableAggregateFields,
	householdId: Schema.String,
	name: Schema.String,
	locale: LocaleSchema,
	timezone: Schema.NullOr(TimeZoneSchema),
	weekStartsOn: Schema.Literal(0, 1),
	defaultPlannedYield: Schema.Number.pipe(Schema.int(), Schema.positive()),
	preferredDinnerTime: Schema.NullOr(LocalTimeSchema),
	createdByUserId: Schema.NullOr(Schema.String),
	deletionState: HouseholdDeletionStateSchema,
	localOnly: Schema.Boolean
});
export type Household = typeof HouseholdSchema.Type;

export const MembershipStatusSchema = Schema.Literal('active', 'detached', 'revoked');
export type MembershipStatus = typeof MembershipStatusSchema.Type;

export const MembershipSourceSchema = Schema.Literal('workos', 'localFork');
export type MembershipSource = typeof MembershipSourceSchema.Type;

export const MembershipSchema = Schema.Struct({
	membershipId: Schema.String,
	householdId: Schema.String,
	workosUserId: Schema.String,
	roleSlug: HouseholdRoleSchema,
	permissions: Schema.Array(HouseholdPermissionSchema),
	status: MembershipStatusSchema,
	directoryManaged: Schema.Boolean,
	workosCreatedAt: UtcInstantSchema,
	lastVerifiedAt: UtcInstantSchema,
	updatedAt: UtcInstantSchema,
	detachedAt: Schema.NullOr(UtcInstantSchema),
	denialCode: Schema.NullOr(Schema.String),
	source: MembershipSourceSchema
});
export type Membership = typeof MembershipSchema.Type;

export const applianceValues = [
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
export const ApplianceSchema = Schema.Literal(...applianceValues);
export type Appliance = typeof ApplianceSchema.Type;

export const HouseholdApplianceSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	householdId: Schema.String,
	appliance: ApplianceSchema,
	available: Schema.Boolean,
	notes: Schema.NullOr(Schema.String)
});
export type HouseholdAppliance = typeof HouseholdApplianceSchema.Type;

export const HouseholdInviteSummarySchema = Schema.Struct({
	id: DomainIdSchema,
	householdId: Schema.String,
	createdByUserId: Schema.String,
	roleSlug: HouseholdRoleSchema,
	maxUses: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(1, 100))),
	usesCount: Schema.NonNegativeInt,
	expiresAt: UtcInstantSchema,
	revokedAt: Schema.NullOr(UtcInstantSchema),
	createdAt: UtcInstantSchema
});
export type HouseholdInviteSummary = typeof HouseholdInviteSummarySchema.Type;

export const HouseholdSettingsPatchSchema = Schema.Struct({
	name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
	locale: Schema.optional(LocaleSchema),
	timezone: Schema.optional(Schema.NullOr(TimeZoneSchema)),
	weekStartsOn: Schema.optional(Schema.Literal(0, 1)),
	defaultPlannedYield: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 24))),
	preferredDinnerTime: Schema.optional(Schema.NullOr(LocalTimeSchema))
});
export type HouseholdSettingsPatch = typeof HouseholdSettingsPatchSchema.Type;

export const HouseholdAppliancePatchSchema = Schema.Struct({
	id: DomainIdSchema,
	appliance: ApplianceSchema,
	available: Schema.Boolean,
	notes: Schema.NullOr(Schema.String)
});
export type HouseholdAppliancePatch = typeof HouseholdAppliancePatchSchema.Type;
