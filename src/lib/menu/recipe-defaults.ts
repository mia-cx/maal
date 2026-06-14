import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

export const emptyRecipeMenuStats = (): Pick<
	RecipeMenuItem,
	'appliances' | 'timesCooked' | 'plannedCount' | 'reviewSummary'
> => ({
	appliances: [],
	timesCooked: 0,
	plannedCount: 0,
	reviewSummary: {
		worthRepeating: 0,
		neutral: 0,
		neverAgain: 0,
		notes: []
	}
});
