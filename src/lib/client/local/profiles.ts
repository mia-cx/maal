import { Data, Schema } from 'effect';

import { MAX_AUTHENTICATED_SLOTS } from '$lib/auth-slots/contracts.js';
import { DomainIdSchema, UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import { ProfileSchema, type Profile } from '$lib/domain/household/contracts.js';

import type { MaalDatabase } from './database.js';

const ACTIVE_PROFILE_KEY = 'activeProfileId';
const profileLockKey = (profileId: string) => `profileLock:${profileId}`;
export const activeHouseholdKey = (profileId: string) => `activeHouseholdId:${profileId}`;

const PIN_ITERATIONS = 310_000;
const PIN_PATTERN = /^\d{4,8}$/;

export class LocalProfileMissing extends Data.TaggedError('LocalProfileMissing')<{
	readonly profileId: string;
}> {}

export class LocalProfileCapacityExceeded extends Data.TaggedError('LocalProfileCapacityExceeded')<{
	readonly maximum: typeof MAX_AUTHENTICATED_SLOTS;
}> {}

export class ProfilePinRequired extends Data.TaggedError('ProfilePinRequired')<{
	readonly profileId: string;
}> {}

export class ProfilePinInvalid extends Data.TaggedError('ProfilePinInvalid')<{
	readonly profileId: string;
}> {}

export class ProfilePinFormatInvalid extends Data.TaggedError('ProfilePinFormatInvalid')<
	Record<never, never>
> {}

const base64Url = (bytes: Uint8Array): string => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
	const normalized = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(value.length / 4) * 4, '=');
	return new Uint8Array(
		Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)).buffer
	);
};

const derivePinVerifier = async (pin: string, salt: Uint8Array<ArrayBuffer>): Promise<string> => {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pin),
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS },
		key,
		256
	);
	return base64Url(new Uint8Array(bits));
};

const equalVerifier = (left: string, right: string): boolean => {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
};

const nowUtc = (): `${string}Z` => new Date().toISOString() as `${string}Z`;

export const addOrUpdateLocalProfile = async (
	database: MaalDatabase,
	profile: Profile
): Promise<void> => {
	const decoded = Schema.decodeUnknownSync(ProfileSchema)(profile);
	const existing = await database.profiles.get(decoded.profileId);
	if (!existing && decoded.authState === 'authenticated') {
		const authenticated = await database.profiles
			.where('authState')
			.anyOf('authenticated', 'stale')
			.count();
		if (authenticated >= MAX_AUTHENTICATED_SLOTS) {
			throw new LocalProfileCapacityExceeded({ maximum: MAX_AUTHENTICATED_SLOTS });
		}
	}
	await database.profiles.put(decoded);
};

export const setProfilePin = async (
	database: MaalDatabase,
	profileId: string,
	pin: string
): Promise<void> => {
	if (!PIN_PATTERN.test(pin)) throw new ProfilePinFormatInvalid();
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const verifier = await derivePinVerifier(pin, salt);
	await database.transaction('rw', database.profiles, database.uiState, async () => {
		await database.profiles.update(profileId, {
			pinSalt: base64Url(salt),
			pinVerifier: verifier,
			lockPolicy: 'pin'
		});
		await database.uiState.put({ key: profileLockKey(profileId), value: false });
	});
};

export const clearProfilePin = async (database: MaalDatabase, profileId: string): Promise<void> => {
	const changed = await database.profiles.update(profileId, {
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none'
	});
	if (!changed) throw new LocalProfileMissing({ profileId });
	await database.uiState.delete(profileLockKey(profileId));
};

export const lockProfile = async (database: MaalDatabase, profileId: string): Promise<void> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	if (profile.lockPolicy === 'pin') {
		await database.uiState.put({ key: profileLockKey(profileId), value: true });
	}
};

const assertProfileUnlocked = async (
	database: MaalDatabase,
	profile: Profile,
	pin: string | undefined
): Promise<void> => {
	if (profile.lockPolicy !== 'pin') return;
	const lock = await database.uiState.get(profileLockKey(profile.profileId));
	if (lock?.value !== true) return;
	if (!pin) throw new ProfilePinRequired({ profileId: profile.profileId });
	if (!PIN_PATTERN.test(pin) || !profile.pinSalt || !profile.pinVerifier) {
		throw new ProfilePinInvalid({ profileId: profile.profileId });
	}
	const candidate = await derivePinVerifier(pin, decodeBase64Url(profile.pinSalt));
	if (!equalVerifier(candidate, profile.pinVerifier)) {
		throw new ProfilePinInvalid({ profileId: profile.profileId });
	}
};

export const switchActiveProfile = async (
	database: MaalDatabase,
	profileId: string,
	pin?: string,
	now: `${string}Z` = nowUtc()
): Promise<Profile> => {
	const decodedNow = Schema.decodeUnknownSync(UtcInstantSchema)(now);
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	await assertProfileUnlocked(database, profile, pin);

	await database.transaction('rw', database.profiles, database.uiState, async () => {
		const currentId = (await database.uiState.get(ACTIVE_PROFILE_KEY))?.value;
		if (typeof currentId === 'string' && currentId !== profileId) {
			const current = await database.profiles.get(currentId);
			if (current?.lockPolicy === 'pin') {
				await database.uiState.put({ key: profileLockKey(currentId), value: true });
			}
		}
		await database.uiState.bulkPut([
			{ key: ACTIVE_PROFILE_KEY, value: profileId },
			{ key: profileLockKey(profileId), value: false }
		]);
		await database.profiles.update(profileId, { lastUsedAt: decodedNow });
	});

	return { ...profile, lastUsedAt: decodedNow };
};

export const readActiveProfile = async (database: MaalDatabase): Promise<Profile | null> => {
	const profileId = (await database.uiState.get(ACTIVE_PROFILE_KEY))?.value;
	if (typeof profileId !== 'string') return null;
	return (await database.profiles.get(profileId)) ?? null;
};

export const markProfileReauthRequired = async (
	database: MaalDatabase,
	profileId: string
): Promise<void> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	await database.transaction('rw', database.profiles, database.authSlots, async () => {
		await database.profiles.update(profileId, { authState: 'reauthRequired' });
		await database.authSlots.where('profileId').equals(profileId).modify({
			sessionState: 'reauthRequired'
		});
	});
};

export const finalizeProfileSignOut = async (
	database: MaalDatabase,
	profileId: string
): Promise<void> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	await database.transaction('rw', database.profiles, database.authSlots, async () => {
		await database.profiles.update(profileId, { authState: 'signedOut' });
		await database.authSlots
			.where('profileId')
			.equals(profileId)
			.modify({ sessionState: 'revoked' });
	});
};

export interface RemoveProfileResult {
	readonly removedProfileId: string;
	readonly removedHouseholdIds: readonly string[];
	readonly retainedHouseholdIds: readonly string[];
}

export const removeProfileFromDevice = async (
	database: MaalDatabase,
	profileId: string
): Promise<RemoveProfileResult> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	const ownMemberships = await database.memberships
		.where('workosUserId')
		.equals(profile.workosUserId)
		.toArray();
	const otherProfiles = await database.profiles.where('profileId').notEqual(profileId).toArray();
	const otherUserIds = new Set(otherProfiles.map(({ workosUserId }) => workosUserId));
	const retainedHouseholdIds: string[] = [];
	const removedHouseholdIds: string[] = [];

	for (const membership of ownMemberships) {
		const memberships = await database.memberships
			.where('householdId')
			.equals(membership.householdId)
			.toArray();
		if (
			memberships.some(
				(candidate) => candidate.status !== 'revoked' && otherUserIds.has(candidate.workosUserId)
			)
		) {
			retainedHouseholdIds.push(membership.householdId);
		} else {
			removedHouseholdIds.push(membership.householdId);
		}
	}

	await database.transaction('rw', database.tables, async () => {
		const removedMealIds = new Set<string>();
		for (const householdId of removedHouseholdIds) {
			for (const meal of await database.meals.where('householdId').equals(householdId).toArray()) {
				removedMealIds.add(meal.id);
			}
		}

		await database.recipes.where('ownerUserId').equals(profile.workosUserId).delete();
		await database.mealCheckIns
			.filter(
				(checkIn) =>
					(typeof checkIn.mealId === 'string' && removedMealIds.has(checkIn.mealId)) ||
					(checkIn.mealId === null && checkIn.reporterUserId === profile.workosUserId)
			)
			.delete();
		for (const tableName of [
			'foodUserAliases',
			'foodUserEntries',
			'unitUserAliases',
			'unitUserEntries',
			'userFoodPreferences',
			'userFoodDisplayPreferences',
			'userUnitDisplayPreferences'
		] as const) {
			await database.table(tableName).where('workosUserId').equals(profile.workosUserId).delete();
		}
		await database.mcpKeySummaries.where('ownerUserId').equals(profile.workosUserId).delete();

		for (const householdId of removedHouseholdIds) {
			await database.households.delete(householdId);
			await database.memberships.where('householdId').equals(householdId).delete();
			await database.householdInvites.where('householdId').equals(householdId).delete();
			await database.householdAppliances.where('householdId').equals(householdId).delete();
			await database.meals.where('householdId').equals(householdId).delete();
			for (const tableName of [
				'foodHouseholdAliases',
				'foodHouseholdEntries',
				'unitHouseholdAliases',
				'unitHouseholdEntries',
				'householdFoodDisplayPreferences',
				'householdUnitDisplayPreferences'
			] as const) {
				await database.table(tableName).where('householdId').equals(householdId).delete();
			}
			await database.billingCapabilities.delete(householdId);
			await database.outbox.filter((mutation) => mutation.scopeId === householdId).delete();
			await database.syncScopes.filter((scope) => scope.scopeId === householdId).delete();
			await database.backfillCheckpoints
				.filter((checkpoint) => checkpoint.scopeId === householdId)
				.delete();
		}

		await database.memberships.where('workosUserId').equals(profile.workosUserId).delete();
		if (slot) {
			await database.outbox.filter((mutation) => mutation.authSlotId === slot.authSlotId).delete();
		}
		await database.outbox
			.filter(
				(mutation) => mutation.scopeKind === 'user' && mutation.scopeId === profile.workosUserId
			)
			.delete();
		await database.syncScopes
			.filter((scope) => scope.scopeKind === 'user' && scope.scopeId === profile.workosUserId)
			.delete();
		await database.backfillCheckpoints
			.filter(
				(checkpoint) =>
					checkpoint.scopeKind === 'user' && checkpoint.scopeId === profile.workosUserId
			)
			.delete();
		await database.authSlots.where('profileId').equals(profileId).delete();
		await database.profiles.delete(profileId);
		await database.uiState.delete(profileLockKey(profileId));
		await database.uiState.delete(activeHouseholdKey(profileId));

		const activeProfile = await database.uiState.get(ACTIVE_PROFILE_KEY);
		if (activeProfile?.value === profileId) {
			const replacement = await database.profiles.orderBy('lastUsedAt').last();
			if (replacement) {
				await database.uiState.put({ key: ACTIVE_PROFILE_KEY, value: replacement.profileId });
			} else {
				await database.uiState.delete(ACTIVE_PROFILE_KEY);
			}
		}
	});

	return { removedProfileId: profileId, removedHouseholdIds, retainedHouseholdIds };
};

export const profileIdSchema = DomainIdSchema;
