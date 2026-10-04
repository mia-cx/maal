import { Data } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import {
	finalizeProfileSignOut,
	LocalProfileMissing,
	removeProfileFromDevice,
	type RemoveProfileResult
} from '$lib/client/local/profiles.js';

export class ProfileSessionRevocationFailed extends Data.TaggedError(
	'ProfileSessionRevocationFailed'
)<{
	readonly profileId: string;
	readonly status: number | null;
}> {}

type Fetch = typeof globalThis.fetch;

const revokeProfileSlot = async (
	database: MaalDatabase,
	profileId: string,
	fetcher: Fetch
): Promise<void> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) throw new LocalProfileMissing({ profileId });
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	if (!slot || slot.sessionState === 'revoked') return;

	let response: Response;
	try {
		response = await fetcher(`/api/auth-slots/${encodeURIComponent(slot.authSlotId)}/`, {
			method: 'DELETE'
		});
	} catch {
		throw new ProfileSessionRevocationFailed({ profileId, status: null });
	}
	if (!response.ok) {
		throw new ProfileSessionRevocationFailed({ profileId, status: response.status });
	}
};

export const signOutLocalProfile = async (
	database: MaalDatabase,
	profileId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<void> => {
	await revokeProfileSlot(database, profileId, fetcher);
	await finalizeProfileSignOut(database, profileId);
};

export const removeLocalProfileFromDevice = async (
	database: MaalDatabase,
	profileId: string,
	options: {
		readonly fetcher?: Fetch;
		readonly beforeRemove?: () => Promise<void>;
	} = {}
): Promise<RemoveProfileResult> => {
	await options.beforeRemove?.();
	await revokeProfileSlot(database, profileId, options.fetcher ?? globalThis.fetch);
	return removeProfileFromDevice(database, profileId);
};
