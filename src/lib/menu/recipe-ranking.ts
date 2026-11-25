import type { RecipeMenuItem } from '$lib/menu/menu-types';

export const recipeFrecencyScore = (recipe: RecipeMenuItem): number => {
	const lastCookedAt = recipe.lastCookedAt ? Date.parse(recipe.lastCookedAt) : Number.NaN;
	const daysSinceCooked = Number.isFinite(lastCookedAt)
		? Math.max(0, (Date.now() - lastCookedAt) / 86_400_000)
		: Number.POSITIVE_INFINITY;
	const recencyScore = Number.isFinite(daysSinceCooked) ? 20 / (1 + daysSinceCooked / 14) : 0;
	return recipe.timesCooked * 10 + recipe.plannedCount * 3 + recencyScore;
};

type PreparedRecipeSearch = {
	title: string;
	sourceSiteName: string;
	description: string;
	ingredients: string;
};

const recipeSearchCache = new WeakMap<RecipeMenuItem, PreparedRecipeSearch>();

const prepareRecipeSearch = (recipe: RecipeMenuItem): PreparedRecipeSearch => {
	const cached = recipeSearchCache.get(recipe);
	if (cached) return cached;
	const prepared = {
		title: recipe.title.toLowerCase(),
		sourceSiteName: (recipe.sourceSiteName ?? '').toLowerCase(),
		description: (recipe.description ?? '').toLowerCase(),
		ingredients: (
			recipe.ingredients?.map((ingredient) => ingredient.item).join(' ') ?? ''
		).toLowerCase()
	};
	recipeSearchCache.set(recipe, prepared);
	return prepared;
};

const fuzzyTextScore = (candidate: string, search: string, words: readonly string[]): number => {
	if (!search) return 1;
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

	const matchedWords = words.filter((word) => candidate.includes(word)).length;
	return matchedWords ? 20 + matchedWords * 10 : 0;
};

const scorePreparedRecipe = (
	recipe: PreparedRecipeSearch,
	search: string,
	words: readonly string[]
): number => {
	if (!search) return 1;
	return Math.max(
		fuzzyTextScore(recipe.title, search, words),
		recipe.sourceSiteName ? fuzzyTextScore(recipe.sourceSiteName, search, words) * 0.75 : 0,
		recipe.description ? fuzzyTextScore(recipe.description, search, words) * 0.6 : 0,
		recipe.ingredients ? fuzzyTextScore(recipe.ingredients, search, words) * 0.5 : 0
	);
};

export const fuzzyRecipeScore = (recipe: RecipeMenuItem, search: string): number => {
	const normalizedSearch = search.toLowerCase().trim();
	return scorePreparedRecipe(
		prepareRecipeSearch(recipe),
		normalizedSearch,
		normalizedSearch.split(/\s+/).filter(Boolean)
	);
};

type RankedRecipeCandidate = {
	recipe: RecipeMenuItem;
	frecencyScore: number;
	fuzzyScore: number;
};

const compareRankedRecipes = (left: RankedRecipeCandidate, right: RankedRecipeCandidate): number =>
	right.fuzzyScore - left.fuzzyScore ||
	right.frecencyScore - left.frecencyScore ||
	left.recipe.title.localeCompare(right.recipe.title);

const createRankedCandidate = (
	recipe: RecipeMenuItem,
	search: string,
	words: readonly string[]
): RankedRecipeCandidate => {
	const preparedRecipe = prepareRecipeSearch(recipe);
	return {
		recipe,
		frecencyScore: recipeFrecencyScore(recipe),
		fuzzyScore: search ? scorePreparedRecipe(preparedRecipe, search, words) : 1
	};
};

const bubbleWorstCandidateUp = (heap: RankedRecipeCandidate[], startIndex: number) => {
	let index = startIndex;
	while (index > 0) {
		const parentIndex = Math.floor((index - 1) / 2);
		if (compareRankedRecipes(heap[index]!, heap[parentIndex]!) <= 0) break;
		[heap[index], heap[parentIndex]] = [heap[parentIndex]!, heap[index]!];
		index = parentIndex;
	}
};

const sinkWorstCandidate = (heap: RankedRecipeCandidate[]) => {
	let index = 0;
	while (true) {
		const leftIndex = index * 2 + 1;
		const rightIndex = leftIndex + 1;
		let worstIndex = index;
		if (leftIndex < heap.length && compareRankedRecipes(heap[leftIndex]!, heap[worstIndex]!) > 0) {
			worstIndex = leftIndex;
		}
		if (
			rightIndex < heap.length &&
			compareRankedRecipes(heap[rightIndex]!, heap[worstIndex]!) > 0
		) {
			worstIndex = rightIndex;
		}
		if (worstIndex === index) return;
		[heap[index], heap[worstIndex]] = [heap[worstIndex]!, heap[index]!];
		index = worstIndex;
	}
};

export const rankRecipeWindow = (
	recipes: readonly RecipeMenuItem[],
	query = '',
	limit = 120
): { recipes: RecipeMenuItem[]; total: number } => {
	const search = query.toLowerCase().trim();
	const words = search.split(/\s+/).filter(Boolean);
	const heap: RankedRecipeCandidate[] = [];
	let total = 0;
	for (const recipe of recipes) {
		const candidate = createRankedCandidate(recipe, search, words);
		if (search && candidate.fuzzyScore <= 0) continue;
		total += 1;
		if (heap.length < limit) {
			heap.push(candidate);
			bubbleWorstCandidateUp(heap, heap.length - 1);
			continue;
		}
		if (compareRankedRecipes(candidate, heap[0]!) >= 0) continue;
		heap[0] = candidate;
		sinkWorstCandidate(heap);
	}
	return {
		recipes: heap.toSorted(compareRankedRecipes).map((candidate) => candidate.recipe),
		total
	};
};

export const rankRecipesByRelevance = (
	recipes: readonly RecipeMenuItem[],
	query = ''
): RecipeMenuItem[] => {
	const search = query.toLowerCase().trim();
	const words = search.split(/\s+/).filter(Boolean);
	return recipes
		.map((recipe) => createRankedCandidate(recipe, search, words))
		.filter((candidate) => !search || candidate.fuzzyScore > 0)
		.sort(compareRankedRecipes)
		.map((candidate) => candidate.recipe);
};
