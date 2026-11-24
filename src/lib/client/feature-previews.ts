import { error, type Load } from '@sveltejs/kit';
import { getBrowserDatabase } from '$lib/client/local/browser.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { readActiveProfile } from '$lib/client/local/profiles.js';

export const featurePreviewFlags = {
	pantry: 'pantry',
	groceryRollup: 'grocery-rollup'
} as const;

export type FeaturePreviewFlag = (typeof featurePreviewFlags)[keyof typeof featurePreviewFlags];
export const featurePreviewsDependency = 'maal:feature-previews';

export const readActiveFeatureFlags = async (database: MaalDatabase): Promise<readonly string[]> =>
	database.transaction('r', database.profiles, database.uiState, database.authSlots, async () => {
		const profile = await readActiveProfile(database);
		if (profile?.authState !== 'authenticated') return [];
		const slot = await database.authSlots.where('profileId').equals(profile.profileId).first();
		return slot?.sessionState === 'authenticated' && slot.workosUserId === profile.workosUserId
			? (slot.featureFlags ?? [])
			: [];
	});

export const loadFeaturePreview =
	(flag: FeaturePreviewFlag): Load =>
	async ({ depends }) => {
		depends(featurePreviewsDependency);
		const flags = await readActiveFeatureFlags(await getBrowserDatabase());
		if (!flags.includes(flag)) error(404, { message: 'Feature not available.' });
	};
