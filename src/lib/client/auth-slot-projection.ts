import { Data, Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	AuthSlotMetadata,
	isAuthSlotId,
	type AuthSlotId,
	type AuthSlotMetadata as AuthSlotMetadataType,
	type AuthSlotStatus
} from '$lib/auth-slots/index.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
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
		[database.profiles, database.authSlots, database.userAttributions, database.uiState],
		async () => {
			const [slot, profileForUser] = await Promise.all([
				database.authSlots.get(metadata.authSlotId),
				database.profiles.where('workosUserId').equals(metadata.workosUserId).first()
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
			const profileId = existing?.profileId ?? uuidv7();
			projectedProfileId = profileId;

			const profile = Schema.decodeUnknownSync(ProfileSchema)({
				profileId,
				workosUserId: metadata.workosUserId,
				displayName: displayNameFor(metadata),
				email: metadata.email,
				profilePictureUrl: metadata.profilePictureUrl,
				locale: existing?.locale ?? safeLocale(options.locale),
				timezone: existing?.timezone ?? safeTimeZone(options.timezone),
				pinSalt: existing?.pinSalt ?? null,
				pinVerifier: existing?.pinVerifier ?? null,
				lockPolicy: existing?.lockPolicy ?? 'none',
				lastUsedAt: now,
				authState: 'authenticated'
			}) satisfies Profile;

			const priorSlot = await database.authSlots.where('profileId').equals(profileId).first();
			if (priorSlot && priorSlot.authSlotId !== metadata.authSlotId) {
				await database.authSlots.delete(priorSlot.authSlotId);
			}
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
			await database.uiState.bulkPut([
				{ key: 'activeProfileId', value: profileId },
				{ key: `profileLock:${profileId}`, value: false }
			]);
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
		throw cause;
	}
};
