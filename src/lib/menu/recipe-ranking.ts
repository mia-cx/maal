import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

export const recipeFrecencyScore = (recipe: RecipeMenuItem): number => {
	const lastCookedAt = recipe.lastCookedAt ? Date.parse(recipe.lastCookedAt) : Number.NaN;
	const daysSinceCooked = Number.isFinite(lastCookedAt)
		? Math.max(0, (Date.now() - lastCookedAt) / 86_400_000)
		: Number.POSITIVE_INFINITY;
	const recencyScore = Number.isFinite(daysSinceCooked) ? 20 / (1 + daysSinceCooked / 14) : 0;
	return recipe.timesCooked * 10 + recipe.plannedCount * 3 + recencyScore;
};

export const fuzzyRecipeScore = (recipe: RecipeMenuItem, search: string): number => {
	if (!search) return 1;
	const title = recipe.title.toLowerCase();
	if (title === search) return 120;
	if (title.startsWith(search)) return 100;
	if (title.includes(search)) return 80;

	let searchIndex = 0;
	let gaps = 0;
	for (const character of title) {
		if (character === search[searchIndex]) {
			searchIndex += 1;
			if (searchIndex === search.length) break;
		} else if (searchIndex > 0) {
			gaps += 1;
		}
	}
	if (searchIndex === search.length) return Math.max(10, 60 - gaps);

	const words = search.split(/\s+/).filter(Boolean);
	const matchedWords = words.filter((word) => title.includes(word)).length;
	return matchedWords ? 20 + matchedWords * 10 : 0;
};

export const rankRecipesByRelevance = (recipes: RecipeMenuItem[], query = ''): RecipeMenuItem[] => {
	const search = query.toLowerCase().trim();
	return recipes
		.map((recipe) => ({
			recipe,
			frecencyScore: recipeFrecencyScore(recipe),
			fuzzyScore: search ? fuzzyRecipeScore(recipe, search) : 1
		}))
		.filter((candidate) => !search || candidate.fuzzyScore > 0)
		.sort(
			(left, right) =>
				right.fuzzyScore - left.fuzzyScore ||
				right.frecencyScore - left.frecencyScore ||
				left.recipe.title.localeCompare(right.recipe.title)
		)
		.map((candidate) => candidate.recipe);
};
