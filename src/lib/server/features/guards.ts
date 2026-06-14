import { error } from '@sveltejs/kit';
import type { AuthSession } from '$lib/server/auth/session';
import { type FeatureFlagSlug, hasFeatureFlag } from '$lib/features/flags';

export const requireFeatureFlag = (session: AuthSession | null, flag: FeatureFlagSlug): void => {
	if (hasFeatureFlag(session, flag)) return;
	error(404, { message: 'Feature not available.' });
};
