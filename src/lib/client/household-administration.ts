import { Data, Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	HouseholdAdministrationProjectionResponseSchema,
	HouseholdInviteResponseSchema,
	HouseholdMemberRemovalResponseSchema,
	HouseholdMembershipResponseSchema,
	type HouseholdAdministrationProjection,
	CreateHouseholdInviteInputSchema,
	createInviteCode,
	type CreateHouseholdInviteInput
} from '$lib/domain/household/index.js';
import {
	HouseholdSchema,
	HouseholdRoleSchema,
	MembershipSchema,
	type HouseholdInviteSummary,
	type HouseholdRole,
	type Membership
} from '$lib/domain/household/contracts.js';
import { requireCachedPermission } from '$lib/domain/household/permissions.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { detachHouseholdSnapshot } from '$lib/client/local/households.js';
import { LocalProfileMissing } from '$lib/client/local/profiles.js';

const LegacyHouseholdMembershipResponseSchema = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	payload: Schema.Struct({ household: HouseholdSchema, membership: MembershipSchema })
});
const CreateJoinResponseSchema = Schema.Union(
	HouseholdAdministrationProjectionResponseSchema,
	LegacyHouseholdMembershipResponseSchema
);

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

const profileSlot = async (
	database: MaalDatabase,
	profileId: string
): Promise<{ authSlotId: string; workosUserId: string }> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	if (!slot || slot.sessionState === 'revoked') {
		throw new HouseholdAdministrationUnavailable({ operation: 'authenticate', status: 401 });
	}
	return { authSlotId: slot.authSlotId, workosUserId: profile.workosUserId };
};

const slotHouseholdPath = (authSlotId: string, householdId: string, suffix: string): string =>
	`/api/auth-slots/${encodeURIComponent(authSlotId)}/households/${encodeURIComponent(householdId)}/${suffix}`;

const slotHouseholdBasePath = (authSlotId: string, householdId: string): string =>
	`/api/auth-slots/${encodeURIComponent(authSlotId)}/households/${encodeURIComponent(householdId)}`;

const commitHouseholdProjection = async (
	database: MaalDatabase,
	profileId: string,
	projection: HouseholdAdministrationProjection,
	selectHousehold: boolean
): Promise<void> => {
	const householdId = projection.household.householdId;
	await database.transaction(
		'rw',
		[
			database.households,
			database.memberships,
			database.householdInvites,
			database.userAttributions,
			database.remoteProjectionMeta,
			database.uiState,
			database.outbox
		],
		async () => {
			const [existingHousehold, existingMemberships, existingInvites, pendingHouseholdMutation] =
				await Promise.all([
					database.households.get(householdId),
					database.memberships.where('householdId').equals(householdId).toArray(),
					database.householdInvites.where('householdId').equals(householdId).toArray(),
					database.outbox
						.where('aggregateId')
						.equals(householdId)
						.filter(
							(mutation) =>
								mutation.scopeKind === 'household' &&
								mutation.scopeId === householdId &&
								mutation.status !== 'acknowledged' &&
								mutation.status !== 'rejected'
						)
						.first()
				]);
			const household =
				existingHousehold && pendingHouseholdMutation
					? {
							...projection.household,
							name: existingHousehold.name,
							locale: existingHousehold.locale,
							timezone: existingHousehold.timezone,
							weekStartsOn: existingHousehold.weekStartsOn,
							defaultPlannedYield: existingHousehold.defaultPlannedYield,
							preferredDinnerTime: existingHousehold.preferredDinnerTime,
							revision: existingHousehold.revision,
							updatedAt: existingHousehold.updatedAt,
							conflictClocks: existingHousehold.conflictClocks
						}
					: projection.household;
			await database.households.put(household);
			await database.memberships.bulkPut(projection.members.map(({ membership }) => membership));
			const projectedMembershipIds = new Set(
				projection.members.map(({ membership }) => membership.membershipId)
			);
			for (const existing of existingMemberships) {
				if (
					existing.source === 'workos' &&
					existing.status === 'active' &&
					!projectedMembershipIds.has(existing.membershipId)
				) {
					await database.memberships.update(existing.membershipId, {
						status: 'revoked',
						updatedAt: projection.membership.lastVerifiedAt,
						denialCode: 'workos_membership_missing'
					});
				}
			}
			await database.householdInvites.bulkPut([...projection.invites]);
			const projectedInviteIds = new Set(projection.invites.map(({ id }) => id));
			await database.householdInvites.bulkDelete(
				existingInvites.filter(({ id }) => !projectedInviteIds.has(id)).map(({ id }) => id)
			);
			await database.userAttributions.bulkPut(
				projection.members.map(({ user }) => ({
					workosUserId: user.workosUserId,
					displayName: user.displayName,
					email: user.email,
					profilePictureUrl: user.profilePictureUrl
				}))
			);
			await database.remoteProjectionMeta.put({
				key: `householdAdministration:${profileId}:${householdId}`,
				refreshedAt: projection.membership.lastVerifiedAt,
				decodeVersion: 1,
				value: { memberCount: projection.members.length, inviteCount: projection.invites.length }
			});
			if (selectHousehold) {
				await database.uiState.put({
					key: `activeHouseholdId:${profileId}`,
					value: householdId
				});
			}
		}
	);
};

const commitCreateJoinProjection = async (
	database: MaalDatabase,
	profileId: string,
	projection:
		| HouseholdAdministrationProjection
		| { household: HouseholdAdministrationProjection['household']; membership: Membership },
	selectHousehold: boolean
): Promise<void> => {
	if ('members' in projection) {
		await commitHouseholdProjection(database, profileId, projection, selectHousehold);
		return;
	}
	await database.transaction(
		'rw',
		database.households,
		database.memberships,
		database.uiState,
		async () => {
			await database.households.put(projection.household);
			await database.memberships.put(projection.membership);
			if (selectHousehold) {
				await database.uiState.put({
					key: `activeHouseholdId:${profileId}`,
					value: projection.household.householdId
				});
			}
		}
	);
};

export interface CreatedHouseholdInvite {
	/** Exists only in the caller's memory for the creation/share ceremony. */
	readonly code: string;
	readonly invite: HouseholdInviteSummary;
}

export const createRemoteHousehold = async (
	database: MaalDatabase,
	profileId: string,
	input: { name: string; locale: string; timezone: string | null },
	fetcher: Fetch = globalThis.fetch
): Promise<{ householdId: string }> => {
	const slot = await profileSlot(database, profileId);
	const response = await requestJson(
		fetcher,
		`/api/auth-slots/${encodeURIComponent(slot.authSlotId)}/households`,
		'create household',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', 'idempotency-key': uuidv7() },
			body: JSON.stringify(input)
		},
		CreateJoinResponseSchema
	);
	await commitCreateJoinProjection(database, profileId, response.payload, true);
	return { householdId: response.payload.household.householdId };
};

export const joinRemoteHousehold = async (
	database: MaalDatabase,
	profileId: string,
	code: string,
	fetcher: Fetch = globalThis.fetch
): Promise<{ householdId: string }> => {
	const slot = await profileSlot(database, profileId);
	const response = await requestJson(
		fetcher,
		`/api/auth-slots/${encodeURIComponent(slot.authSlotId)}/households/join`,
		'join household',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code })
		},
		CreateJoinResponseSchema
	);
	await commitCreateJoinProjection(database, profileId, response.payload, true);
	return { householdId: response.payload.household.householdId };
};

export const refreshRemoteHousehold = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<HouseholdAdministrationProjection> => {
	const { authSlotId } = await profileSlot(database, profileId);
	const response = await requestJson(
		fetcher,
		slotHouseholdBasePath(authSlotId, householdId),
		'refresh household',
		{ method: 'GET' },
		HouseholdAdministrationProjectionResponseSchema
	);
	await commitHouseholdProjection(database, profileId, response.payload, false);
	return response.payload;
};

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
		HouseholdInviteResponseSchema
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
		HouseholdInviteResponseSchema
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
		HouseholdMembershipResponseSchema
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
		HouseholdMemberRemovalResponseSchema
	);
	await database.memberships.update(membershipId, {
		status: 'revoked',
		updatedAt: new Date().toISOString() as `${string}Z`
	});
};

export const leaveRemoteHousehold = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<void> => {
	const { authSlotId } = await profileSlot(database, profileId);
	await requestJson(
		fetcher,
		`${slotHouseholdBasePath(authSlotId, householdId)}/membership`,
		'leave household',
		{ method: 'DELETE' },
		HouseholdMemberRemovalResponseSchema
	);
	await detachHouseholdSnapshot(database, {
		profileId,
		householdId,
		denialCode: 'membership_left'
	});
};
