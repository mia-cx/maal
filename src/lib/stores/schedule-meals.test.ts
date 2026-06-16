import { afterEach, describe, expect, it } from 'vitest';
import {
	hydrateScheduleMeals,
	mergeHydratedScheduleMeals,
	scheduleMealStore,
	selectScheduleMeal,
	selectedMealIdStore,
	selectedMealStore
} from '$lib/stores/schedule-meals';
import type { Meal } from '$lib/components/dashboard/schedule-types';

const meal = (id: string, date?: string): Meal => ({
	id,
	title: id,
	date,
	day: date
});

afterEach(() => {
	hydrateScheduleMeals([]);
	selectScheduleMeal(null);
});

describe('schedule meal stores', () => {
	it('hydrates meals defensively', () => {
		const input = meal('a', '2026-01-01');
		hydrateScheduleMeals([input]);

		expect(scheduleMealStore.get()).toEqual([input]);
		input.title = 'mutated';
		expect(scheduleMealStore.get()[0]?.title).toBe('a');
	});

	it('merges a loaded date range while preserving outside-range and floating meals', () => {
		hydrateScheduleMeals([
			meal('before', '2025-12-31'),
			meal('replace', '2026-01-02'),
			meal('after', '2026-01-04'),
			meal('floating')
		]);

		mergeHydratedScheduleMeals(
			[meal('replace', '2026-01-02'), meal('new', '2026-01-03')],
			'2026-01-01',
			'2026-01-03'
		);

		expect(scheduleMealStore.get().map((item) => item.id)).toEqual([
			'before',
			'after',
			'floating',
			'replace',
			'new'
		]);
	});

	it('projects the selected meal from the meal store', () => {
		hydrateScheduleMeals([meal('a'), meal('b')]);
		selectScheduleMeal('b');

		expect(selectedMealIdStore.get()).toBe('b');
		expect(selectedMealStore.get()?.title).toBe('b');
	});
});
