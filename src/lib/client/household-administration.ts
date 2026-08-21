import { Data, Schema } from 'effect';

import {
	CreateHouseholdInviteInputSchema,
	createInviteCode,
	type CreateHouseholdInviteInput
} from '$lib/domain/household/invites.js';
import {
	HouseholdInviteSummarySchema,
	HouseholdRoleSchema,
	MembershipSchema,
	type HouseholdInviteSummary,
	type HouseholdRole,
	type Membership
} from '$lib/domain/household/contracts.js';
import { requireCachedPermission } from '$lib/domain/household/permissions.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalProfileMissing } from '$lib/client/local/profiles.js';

export class HouseholdAdministrationUnavailable extends Data.TaggedError(
	'HouseholdAdministrationUnavailable'
)<{
	readonly operation: string;
	readonly status: number | null;
}> {}

export class HouseholdAdministrationDecodeError extends Data.TaggedError(
	'HouseholdAdministrationDecodeError'
)<{
	readonly operation: string;
}> {}

type Fetch = typeof globalThis.fetch;

const InviteResponseSchema = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	payload: HouseholdInviteSummarySchema
});
const MembershipResponseSchema = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	payload: MembershipSchema
});

const requestJson = async <A>(
	fetcher: Fetch,
	url: string,
	operation: string,
	init: RequestInit,
	schema: Schema.Schema<A>
): Promise<A> => {
	let response: Response;
	try {
		response = await fetcher(url, init);
	} catch {
		throw new HouseholdAdministrationUnavailable({ operation, status: null });
	}
	if (!response.ok) {
		throw new HouseholdAdministrationUnavailable({ operation, status: response.status });
	}
	try {
		return Schema.decodeUnknownSync(schema)(await response.json());
	} catch {
		throw new HouseholdAdministrationDecodeError({ operation });
	}
};

const adminContext = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string
): Promise<{ authSlotId: string; membership: Membership }> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const membershipRecord = await database.memberships
		.where('[householdId+workosUserId]')
		.equals([householdId, profile.workosUserId])
		.first();
	const membership = membershipRecord
		? Schema.decodeUnknownSync(MembershipSchema)(membershipRecord)
		: undefined;
	requireCachedPermission(membership, householdId, 'households:write');
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	if (!slot || slot.sessionState === 'revoked') {
		throw new HouseholdAdministrationUnavailable({ operation: 'authenticate', status: 401 });
	}
	return { authSlotId: slot.authSlotId, membership: membership as Membership };
};

const slotHouseholdPath = (authSlotId: string, householdId: string, suffix: string): string =>
	`/api/auth-slots/${encodeURIComponent(authSlotId)}/households/${encodeURIComponent(householdId)}/${suffix}`;

export interface CreatedHouseholdInvite {
	/** Exists only in the caller's memory for the creation/share ceremony. */
	readonly code: string;
	readonly invite: HouseholdInviteSummary;
}

export const createHouseholdInvite = async (
	database: MaalDatabase,
	profileId: string,
	input: CreateHouseholdInviteInput,
	fetcher: Fetch = globalThis.fetch
): Promise<CreatedHouseholdInvite> => {
	const decoded = Schema.decodeUnknownSync(CreateHouseholdInviteInputSchema)(input);
	const { authSlotId } = await adminContext(database, profileId, decoded.householdId);
	const code = createInviteCode();
	const response = await requestJson(
		fetcher,
		slotHouseholdPath(authSlotId, decoded.householdId, 'invites'),
		'create household invite',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...decoded, code })
		},
		InviteResponseSchema
	);
	await database.householdInvites.put(response.payload);
	return { code, invite: response.payload };
};

export const revokeHouseholdInvite = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	inviteId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<HouseholdInviteSummary> => {
	const { authSlotId } = await adminContext(database, profileId, householdId);
	const response = await requestJson(
		fetcher,
		`${slotHouseholdPath(authSlotId, householdId, 'invites')}/${encodeURIComponent(inviteId)}`,
		'revoke household invite',
		{ method: 'DELETE' },
		InviteResponseSchema
	);
	await database.householdInvites.put(response.payload);
	return response.payload;
};

const MemberMutationSchema = Schema.Struct({
	householdId: Schema.String,
	membershipId: Schema.String,
	roleSlug: HouseholdRoleSchema
});

export const updateHouseholdMemberRole = async (
	database: MaalDatabase,
	profileId: string,
	input: { householdId: string; membershipId: string; roleSlug: HouseholdRole },
	fetcher: Fetch = globalThis.fetch
): Promise<Membership> => {
	const decoded = Schema.decodeUnknownSync(MemberMutationSchema)(input);
	const { authSlotId } = await adminContext(database, profileId, decoded.householdId);
	const response = await requestJson(
		fetcher,
		`${slotHouseholdPath(authSlotId, decoded.householdId, 'members')}/${encodeURIComponent(decoded.membershipId)}`,
		'update household member role',
		{
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ roleSlug: decoded.roleSlug })
		},
		MembershipResponseSchema
	);
	await database.memberships.put(response.payload);
	return response.payload;
};

export const removeHouseholdMember = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	membershipId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<void> => {
	const { authSlotId } = await adminContext(database, profileId, householdId);
	await requestJson(
		fetcher,
		`${slotHouseholdPath(authSlotId, householdId, 'members')}/${encodeURIComponent(membershipId)}`,
		'remove household member',
		{ method: 'DELETE' },
		Schema.Struct({
			schemaVersion: Schema.Literal(1),
			payload: Schema.Struct({ removed: Schema.Boolean })
		})
	);
	await database.memberships.update(membershipId, {
		status: 'revoked',
		updatedAt: new Date().toISOString() as `${string}Z`
	});
};
