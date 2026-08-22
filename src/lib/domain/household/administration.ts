import { Schema } from 'effect';

import { versionedContract } from '$lib/domain/contracts/schema.js';
import { LocaleSchema, TimeZoneSchema } from '$lib/domain/contracts/primitives.js';

import {
	HouseholdInviteSummarySchema,
	HouseholdRoleSchema,
	HouseholdSchema,
	MembershipSchema
} from './contracts.js';
import { CreateHouseholdInviteInputSchema } from './invites.js';
import { BillingCapabilitySchema } from '$lib/domain/billing/contracts.js';

export const CreateRemoteHouseholdRequestSchema = Schema.Struct({
	name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
	locale: LocaleSchema,
	timezone: Schema.NullOr(TimeZoneSchema)
});
export type CreateRemoteHouseholdRequest = typeof CreateRemoteHouseholdRequestSchema.Type;

export const JoinRemoteHouseholdRequestSchema = Schema.Struct({
	code: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64))
});

export const CreateRemoteHouseholdInviteRequestSchema = Schema.Struct({
	...CreateHouseholdInviteInputSchema.fields,
	code: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64))
});
export type CreateRemoteHouseholdInviteRequest =
	typeof CreateRemoteHouseholdInviteRequestSchema.Type;

export const UpdateRemoteHouseholdMemberRoleRequestSchema = Schema.Struct({
	roleSlug: HouseholdRoleSchema
});

export const HouseholdMemberIdentitySchema = Schema.Struct({
	workosUserId: Schema.String,
	displayName: Schema.String,
	email: Schema.NullOr(Schema.String),
	profilePictureUrl: Schema.NullOr(Schema.String)
});
export type HouseholdMemberIdentity = typeof HouseholdMemberIdentitySchema.Type;

export const HouseholdMemberProjectionSchema = Schema.Struct({
	membership: MembershipSchema,
	user: HouseholdMemberIdentitySchema
});
export type HouseholdMemberProjection = typeof HouseholdMemberProjectionSchema.Type;

export const HouseholdAdministrationProjectionSchema = Schema.Struct({
	household: HouseholdSchema,
	membership: MembershipSchema,
	members: Schema.Array(HouseholdMemberProjectionSchema),
	invites: Schema.Array(HouseholdInviteSummarySchema)
});
export type HouseholdAdministrationProjection = typeof HouseholdAdministrationProjectionSchema.Type;

export const HouseholdAdministrationProjectionResponseSchema = versionedContract(
	HouseholdAdministrationProjectionSchema
);
export const HouseholdDiscoveryEntrySchema = Schema.Struct({
	household: HouseholdSchema,
	membership: MembershipSchema,
	capability: BillingCapabilitySchema
});
export type HouseholdDiscoveryEntry = typeof HouseholdDiscoveryEntrySchema.Type;
export const HouseholdInviteResponseSchema = versionedContract(HouseholdInviteSummarySchema);
export const HouseholdMembershipResponseSchema = versionedContract(MembershipSchema);
export const HouseholdMemberRemovalResponseSchema = versionedContract(
	Schema.Struct({
		householdId: Schema.String,
		membershipId: Schema.String,
		removed: Schema.Literal(true)
	})
);

export const HouseholdAdministrationErrorCodeSchema = Schema.Literal(
	'auth_slot_missing',
	'auth_slot_expired',
	'd1_unavailable',
	'malformed_request',
	'idempotency_key_required',
	'workos_unavailable',
	'household_not_found',
	'membership_not_found',
	'membership_inactive',
	'membership_projection_missing',
	'membership_projection_invalid',
	'permission_denied',
	'directory_managed',
	'last_admin',
	'billing_owner_required',
	'invite_invalid',
	'invite_revoked',
	'invite_expired',
	'invite_exhausted',
	'invite_conflict',
	'mutation_busy',
	'projection_write_failed',
	'compensation_failed'
);
export type HouseholdAdministrationErrorCode = typeof HouseholdAdministrationErrorCodeSchema.Type;

export const HouseholdAdministrationErrorResponseSchema = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	error: Schema.Struct({
		_tag: Schema.Literal('HouseholdAdministrationError'),
		code: HouseholdAdministrationErrorCodeSchema
	})
});
