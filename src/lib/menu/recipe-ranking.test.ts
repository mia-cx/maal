import { describe, expect, it } from 'vitest';
import { rankRecipesByRelevance } from './recipe-ranking';
import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

const recipe = (overrides: Partial<RecipeMenuItem>): RecipeMenuItem => ({
	id: overrides.id ?? overrides.title ?? crypto.randomUUID(),
	title: overrides.title ?? 'Untitled',
	description: '',
	ingredientCount: 0,
	appliances: [],
	timesCooked: 0,
	plannedCount: 0,
	reviewSummary: { worthRepeating: 0, neutral: 0, neverAgain: 0, notes: [] },
	...overrides
});

describe('recipe ranking', () => {
	it('orders menu recipes by frecency before title', () => {
		const ranked = rankRecipesByRelevance([
			recipe({ title: 'A oldest alphabetical recipe' }),
			recipe({ title: 'B planned recipe', plannedCount: 2 }),
			recipe({ title: 'C cooked recipe', timesCooked: 1 })
		]);

		expect(ranked.map((item) => item.title)).toEqual([
			'C cooked recipe',
			'B planned recipe',
			'A oldest alphabetical recipe'
		]);
	});

	it('uses fuzzy relevance before frecency for searched picker results', () => {
		const ranked = rankRecipesByRelevance(
			[
				recipe({ title: 'Pancakes', timesCooked: 10 }),
				recipe({ title: 'Taco night', timesCooked: 1 }),
				recipe({ title: 'Vegetable soup', timesCooked: 20 })
			],
			'taco'
		);

		expect(ranked.map((item) => item.title)).toEqual(['Taco night']);
	});
});
