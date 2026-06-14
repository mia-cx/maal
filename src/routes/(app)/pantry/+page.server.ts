import type { PageServerLoad } from './$types';
import { featureFlagSlugs } from '$lib/features/flags';
import { requireFeatureFlag } from '$lib/server/features/guards';

export const load: PageServerLoad = ({ locals }) => {
	requireFeatureFlag(locals.session, featureFlagSlugs.pantry);
	return {};
};
