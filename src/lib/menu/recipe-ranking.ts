import type { RecipeMenuItem } from '$lib/menu/menu-types';

export const recipeFrecencyScore = (recipe: RecipeMenuItem): number => {
	const lastCookedAt = recipe.lastCookedAt ? Date.parse(recipe.lastCookedAt) : Number.NaN;
	const daysSinceCooked = Number.isFinite(lastCookedAt)
		? Math.max(0, (Date.now() - lastCookedAt) / 86_400_000)
		: Number.POSITIVE_INFINITY;
	const recencyScore = Number.isFinite(daysSinceCooked) ? 20 / (1 + daysSinceCooked / 14) : 0;
	return recipe.timesCooked * 10 + recipe.plannedCount * 3 + recencyScore;
};

const fuzzyTextScore = (text: string, search: string): number => {
	if (!search) return 1;
	const candidate = text.toLowerCase();
	if (candidate === search) return 120;
	if (candidate.startsWith(search)) return 100;
	if (candidate.includes(search)) return 80;

	let searchIndex = 0;
	let gaps = 0;
	for (const character of candidate) {
		if (character === search[searchIndex]) {
			searchIndex += 1;
			if (searchIndex === search.length) break;
		} else if (searchIndex > 0) {
			gaps += 1;
		}
	}
	if (searchIndex === search.length) return Math.max(10, 60 - gaps);

	const words = search.split(/\s+/).filter(Boolean);
	const matchedWords = words.filter((word) => candidate.includes(word)).length;
	return matchedWords ? 20 + matchedWords * 10 : 0;
};

export const fuzzyRecipeScore = (recipe: RecipeMenuItem, search: string): number => {
	if (!search) return 1;
	return Math.max(
		fuzzyTextScore(recipe.title, search),
		fuzzyTextScore(recipe.sourceSiteName ?? '', search) * 0.75,
		fuzzyTextScore(recipe.description ?? '', search) * 0.6,
		fuzzyTextScore(
			recipe.ingredients?.map((ingredient) => ingredient.item).join(' ') ?? '',
			search
		) * 0.5
	);
};

export const rankRecipesByRelevance = (
	recipes: readonly RecipeMenuItem[],
	query = ''
): RecipeMenuItem[] => {
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
