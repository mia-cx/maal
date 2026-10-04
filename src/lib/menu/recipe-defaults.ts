import type { RecipeMenuItem } from '$lib/menu/menu-types';

/** Recipe fields derived from household meals and check-ins, never stored on the recipe. */
export type RecipeMenuStats = Pick<
	RecipeMenuItem,
	| 'timesCooked'
	| 'plannedCount'
	| 'lastCookedAt'
	| 'averageActualMinutes'
	| 'latestVerdict'
	| 'reviewSummary'
>;

/** Statistics for a recipe with no visible meals or check-ins. */
export const emptyRecipeStats = (): RecipeMenuStats => ({
	timesCooked: 0,
	plannedCount: 0,
	reviewSummary: {
		worthRepeating: 0,
		neutral: 0,
		neverAgain: 0,
		notes: []
	}
});

export const emptyRecipeMenuStats = (): Pick<RecipeMenuItem, 'appliances'> & RecipeMenuStats => ({
	appliances: [],
	...emptyRecipeStats()
});
