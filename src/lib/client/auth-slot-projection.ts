import { Data, Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	assertAuthSlotCapacity,
	AuthSlotCapacityExceeded,
	AuthSlotMetadata,
	isAuthSlotId,
	type AuthSlotId,
	type AuthSlotMetadata as AuthSlotMetadataType,
	type AuthSlotStatus
} from '$lib/auth-slots/index.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import {
	activeHouseholdKey,
	pinResetKey,
	profileLockKey,
	signedOutAuthSlotId
} from '$lib/client/local/profiles.js';
import type { AuthSlotRecord } from '$lib/client/local/records.js';
import {
	LocaleSchema,
	TimeZoneSchema,
	UtcInstantSchema
} from '$lib/domain/contracts/primitives.js';
import { ProfileSchema, type Profile } from '$lib/domain/household/contracts.js';

export interface AuthCallbackMarker {
	readonly authSlotId: AuthSlotId;
	readonly authStatus: AuthSlotStatus;
}

export type AuthProjectionOutcome =
	| { readonly state: 'authenticated'; readonly profileId: string; readonly authSlotId: AuthSlotId }
	| {
			readonly state: 'stale' | 'reauthRequired';
			readonly profileId: string | null;
			readonly authSlotId: AuthSlotId;
	  };

export class AuthSlotMetadataUnavailable extends Data.TaggedError('AuthSlotMetadataUnavailable')<{
	readonly authSlotId: AuthSlotId;
	readonly status: number | null;
}> {}

export class AuthSlotMetadataInvalid extends Data.TaggedError('AuthSlotMetadataInvalid')<{
	readonly authSlotId: AuthSlotId;
}> {}

export class AuthSlotProjectionIdentityMismatch extends Data.TaggedError(
	'AuthSlotProjectionIdentityMismatch'
)<{
	readonly authSlotId: AuthSlotId;
	readonly expectedUserId: string;
	readonly actualUserId: string;
}> {}

type Fetch = typeof globalThis.fetch;

const callbackStatus = (value: string | null): AuthSlotStatus | null => {
	if (value === 'authenticated' || value === 'stale' || value === 'reauthRequired') return value;
	return null;
};

export const takeAuthCallbackMarker = (
	url: URL,
	replaceHistory: (url: string) => void
): AuthCallbackMarker | null => {
	const rawSlotId = url.searchParams.get('authSlot');
	const rawStatus = url.searchParams.get('authStatus');
	if (rawSlotId === null && rawStatus === null) return null;

	const cleanUrl = new URL(url);
	cleanUrl.searchParams.delete('authSlot');
	cleanUrl.searchParams.delete('authStatus');
	replaceHistory(`${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

	const status = callbackStatus(rawStatus);
	return rawSlotId && isAuthSlotId(rawSlotId) && status
		? { authSlotId: rawSlotId, authStatus: status }
		: null;
};

const displayNameFor = (
	metadata: Extract<AuthSlotMetadataType, { status: 'authenticated' }>
): string => {
	const name = [metadata.firstName, metadata.lastName]
		.filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
		.join(' ')
		.trim();
	return name || metadata.email.split('@')[0] || 'Maal profile';
};

/**
 * The slots holding one of the eight retained sessions (spec §4.1). Signed-out and reauth-required
 * profiles hold none. The profile switcher and the sign-in projection both count with this.
 */
export const retainedAuthSlots = (
	views: readonly {
		readonly profile: Pick<Profile, 'authState'>;
		readonly slot: Pick<AuthSlotRecord, 'authSlotId'> | null;
	}[]
): { authSlotId: AuthSlotId; status: 'authenticated' | 'stale' }[] =>
	views.flatMap(({ profile: { authState }, slot }) =>
		slot &&
		isAuthSlotId(slot.authSlotId) &&
		(authState === 'authenticated' || authState === 'stale')
			? [{ authSlotId: slot.authSlotId, status: authState }]
			: []
	);

const safeLocale = (value: string): string => (Schema.is(LocaleSchema)(value) ? value : 'en-US');
const safeTimeZone = (value: string | null): string | null =>
	value !== null && Schema.is(TimeZoneSchema)(value) ? value : null;

const markSlotState = async (
	database: MaalDatabase,
	authSlotId: AuthSlotId,
	state: 'stale' | 'reauthRequired'
): Promise<AuthProjectionOutcome> => {
	let profileId: string | null = null;
	await database.transaction('rw', database.profiles, database.authSlots, async () => {
		const slot = await database.authSlots.get(authSlotId);
		if (!slot) return;
		profileId = slot.profileId;
		await database.authSlots.update(authSlotId, {
			sessionState: state === 'stale' ? 'reauthRequired' : state,
			nextRetryAt: null
		});
		await database.profiles.update(slot.profileId, { authState: state });
	});
	return { state, profileId, authSlotId };
};

const upsertAuthenticatedSlot = async (
	database: MaalDatabase,
	metadata: Extract<AuthSlotMetadataType, { status: 'authenticated' }>,
	options: { readonly locale: string; readonly timezone: string | null; readonly now: string }
): Promise<AuthProjectionOutcome> => {
	const now = Schema.decodeUnknownSync(UtcInstantSchema)(options.now);
	let projectedProfileId = '';

	await database.transaction(
		'rw',
		[
			database.profiles,
			database.authSlots,
			database.userAttributions,
			database.households,
			database.memberships,
			database.billingCapabilities,
			database.uiState,
			database.outbox
		],
		async () => {
			const [slot, profileForUser, profiles, slots] = await Promise.all([
				database.authSlots.get(metadata.authSlotId),
				database.profiles.where('workosUserId').equals(metadata.workosUserId).first(),
				database.profiles.toArray(),
				database.authSlots.toArray()
			]);

			if (slot && slot.workosUserId !== metadata.workosUserId) {
				throw new AuthSlotProjectionIdentityMismatch({
					authSlotId: metadata.authSlotId,
					expectedUserId: slot.workosUserId,
					actualUserId: metadata.workosUserId
				});
			}

			const profileForSlot = slot ? await database.profiles.get(slot.profileId) : null;
			const existing = profileForSlot ?? profileForUser ?? null;
			const slotByProfile = new Map(slots.map((record) => [record.profileId, record]));
			const priorSlot = existing ? slotByProfile.get(existing.profileId) : undefined;
			assertAuthSlotCapacity(
				retainedAuthSlots(
					profiles.map((profile) => ({
						profile,
						slot: slotByProfile.get(profile.profileId) ?? null
					}))
				),
				priorSlot && isAuthSlotId(priorSlot.authSlotId) ? priorSlot.authSlotId : undefined
			);
			const profileId = existing?.profileId ?? uuidv7();
			projectedProfileId = profileId;
			const pinReset = (await database.uiState.get(pinResetKey(profileId)))?.value === true;

			const profile = Schema.decodeUnknownSync(ProfileSchema)({
				profileId,
				workosUserId: metadata.workosUserId,
				displayName: displayNameFor(metadata),
				email: metadata.email,
				profilePictureUrl: metadata.profilePictureUrl,
				locale: existing?.locale ?? safeLocale(options.locale),
				timezone: existing?.timezone ?? safeTimeZone(options.timezone),
				pinSalt: pinReset ? null : (existing?.pinSalt ?? null),
				pinVerifier: pinReset ? null : (existing?.pinVerifier ?? null),
				lockPolicy: pinReset ? 'none' : (existing?.lockPolicy ?? 'none'),
				lastUsedAt: now,
				authState: 'authenticated'
			}) satisfies Profile;

			if (priorSlot && priorSlot.authSlotId !== metadata.authSlotId) {
				await database.authSlots.delete(priorSlot.authSlotId);
			}
			// Work queued while signed out or under the earlier slot uploads with the new slot.
			const queuedSlotIds = new Set([signedOutAuthSlotId(profileId), priorSlot?.authSlotId]);
			await database.outbox
				.filter((row) => queuedSlotIds.has(row.authSlotId) && row.status !== 'acknowledged')
				.modify({ authSlotId: metadata.authSlotId });
			await database.profiles.put(profile);
			await database.authSlots.put({
				authSlotId: metadata.authSlotId,
				profileId,
				workosUserId: metadata.workosUserId,
				sessionState: 'authenticated',
				lastRefreshedAt: metadata.verifiedAt,
				lastVerifiedAt: metadata.verifiedAt,
				nextRetryAt: null,
				retryCount: 0
			});
			await database.userAttributions.put({
				workosUserId: metadata.workosUserId,
				displayName: profile.displayName,
				profilePictureUrl: profile.profilePictureUrl
			});
			const discovered = metadata.households ?? [];
			if (discovered.length > 0) {
				// A household with unsent local edits keeps them; sync reconciles it later.
				const editedHouseholdIds = new Set(
					(
						await database.outbox
							.where('aggregateId')
							.anyOf(discovered.map(({ household }) => household.householdId))
							.filter(({ status }) => status !== 'acknowledged' && status !== 'rejected')
							.toArray()
					).map(({ aggregateId }) => aggregateId)
				);
				await database.households.bulkPut(
					discovered
						.map(({ household }) => household)
						.filter(({ householdId }) => !editedHouseholdIds.has(householdId))
				);
				await database.memberships.bulkPut(discovered.map(({ membership }) => membership));
				await database.billingCapabilities.bulkPut(discovered.map(({ capability }) => capability));
			}
			if (pinReset) await database.uiState.delete(pinResetKey(profileId));
			const uiState = [
				{ key: 'activeProfileId', value: profileId },
				{ key: profileLockKey(profileId), value: false }
			];
			if (discovered.length > 0 && !(await database.uiState.get(activeHouseholdKey(profileId)))) {
				uiState.push({
					key: activeHouseholdKey(profileId),
					value: discovered[0]!.household.householdId
				});
			}
			await database.uiState.bulkPut(uiState);
		}
	);

	return { state: 'authenticated', profileId: projectedProfileId, authSlotId: metadata.authSlotId };
};

export const projectAuthCallback = async (
	database: MaalDatabase,
	marker: AuthCallbackMarker,
	options: {
		readonly fetcher?: Fetch;
		readonly locale?: string;
		readonly timezone?: string | null;
		readonly now?: string;
	} = {}
): Promise<AuthProjectionOutcome> => {
	const fetcher = options.fetcher ?? globalThis.fetch;
	let response: Response;
	try {
		response = await fetcher(`/api/auth-slots/${encodeURIComponent(marker.authSlotId)}/`, {
			method: 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: { accept: 'application/json' }
		});
	} catch {
		await markSlotState(database, marker.authSlotId, 'stale');
		throw new AuthSlotMetadataUnavailable({ authSlotId: marker.authSlotId, status: null });
	}

	if (!response.ok) {
		const state = response.status === 401 || response.status === 403 ? 'reauthRequired' : 'stale';
		await markSlotState(database, marker.authSlotId, state);
		throw new AuthSlotMetadataUnavailable({
			authSlotId: marker.authSlotId,
			status: response.status
		});
	}

	let metadata: AuthSlotMetadataType;
	try {
		metadata = Schema.decodeUnknownSync(AuthSlotMetadata)(await response.json());
	} catch {
		await markSlotState(database, marker.authSlotId, 'stale');
		throw new AuthSlotMetadataInvalid({ authSlotId: marker.authSlotId });
	}
	if (metadata.authSlotId !== marker.authSlotId) {
		await markSlotState(database, marker.authSlotId, 'stale');
		throw new AuthSlotMetadataInvalid({ authSlotId: marker.authSlotId });
	}

	if (metadata.status !== 'authenticated') {
		return markSlotState(database, marker.authSlotId, metadata.status);
	}

	try {
		return await upsertAuthenticatedSlot(database, metadata, {
			locale: options.locale ?? 'en-US',
			timezone: options.timezone ?? null,
			now: options.now ?? new Date().toISOString()
		});
	} catch (cause) {
		if (cause instanceof AuthSlotProjectionIdentityMismatch) {
			await markSlotState(database, marker.authSlotId, 'reauthRequired');
		}
		if (cause instanceof AuthSlotCapacityExceeded) {
			// The callback already set this slot's cookie; revoke it so no ninth session is retained.
			await fetcher(`/api/auth-slots/${encodeURIComponent(marker.authSlotId)}/`, {
				method: 'DELETE'
			});
		}
		throw cause;
	}
};
