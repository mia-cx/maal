import type { PublicAuthSession } from '$lib/server/auth/session';

export const featureFlagSlugs = {
	pantry: 'pantry',
	groceryRollup: 'grocery-rollup'
} as const;

export type FeatureFlagSlug = (typeof featureFlagSlugs)[keyof typeof featureFlagSlugs];

export type FeaturePreviews = {
	pantry: boolean;
	groceryRollup: boolean;
};

export const hasFeatureFlag = (
	session: Pick<PublicAuthSession, 'featureFlags'> | null | undefined,
	flag: FeatureFlagSlug
): boolean => Boolean(session?.featureFlags.includes(flag));

export const featurePreviews = (
	session: Pick<PublicAuthSession, 'featureFlags'> | null | undefined
): FeaturePreviews => ({
	pantry: hasFeatureFlag(session, featureFlagSlugs.pantry),
	groceryRollup: hasFeatureFlag(session, featureFlagSlugs.groceryRollup)
});
