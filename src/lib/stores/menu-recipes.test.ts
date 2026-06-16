import { afterEach, describe, expect, it } from 'vitest';
import {
	appendMenuRecipes,
	archivedMenuRecipesStore,
	hydrateMenuRecipes,
	menuRecipesStore,
	selectMenuRecipe,
	selectedMenuRecipeIdStore,
	selectedMenuRecipeStore
} from '$lib/stores/menu-recipes';
import type { RecipeMenuItem } from '$lib/components/menu';

const recipe = (id: string, title = id): RecipeMenuItem => ({
	id,
	title,
	description: '',
	ingredientCount: 0,
	appliances: [],
	timesCooked: 0,
	plannedCount: 0,
	reviewSummary: { worthRepeating: 0, neutral: 0, neverAgain: 0, notes: [] }
});

afterEach(() => {
	hydrateMenuRecipes([], []);
	selectMenuRecipe(null);
});

describe('menu recipe stores', () => {
	it('hydrates active and archived recipes defensively', () => {
		const active = recipe('active');
		const archived = recipe('archived');
		hydrateMenuRecipes([active], [archived]);

		expect(menuRecipesStore.get()).toEqual([active]);
		expect(archivedMenuRecipesStore.get()).toEqual([archived]);

		active.title = 'mutated';
		expect(menuRecipesStore.get()[0]?.title).toBe('active');
	});

	it('appends recipes without duplicating existing ids', () => {
		hydrateMenuRecipes([recipe('a'), recipe('b')], []);
		appendMenuRecipes([recipe('b', 'updated b'), recipe('c')]);

		expect(menuRecipesStore.get().map(({ id, title }) => [id, title])).toEqual([
			['a', 'a'],
			['b', 'updated b'],
			['c', 'c']
		]);
	});

	it('projects the selected recipe from the active menu store', () => {
		hydrateMenuRecipes([recipe('a'), recipe('b')], []);
		selectMenuRecipe('b');

		expect(selectedMenuRecipeIdStore.get()).toBe('b');
		expect(selectedMenuRecipeStore.get()?.title).toBe('b');
	});
});
