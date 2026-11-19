import { describe, expect, test } from 'vitest';

import { moveMealToDropTarget } from './schedule-dnd.js';
import { isMealInPool, sortScheduledMeals } from './schedule-ordering.js';
import type { Meal } from './schedule-types.js';

const meal = (id: string, patch: Partial<Meal> = {}): Meal => ({ id, title: id, ...patch });

describe('schedule ordering', () => {
	test('keeps undated meals in the pool regardless of time', () => {
		expect(isMealInPool(meal('undated'))).toBe(true);
		expect(isMealInPool(meal('undated-timed', { time: '18:30' }))).toBe(true);
		expect(isMealInPool(meal('dated', { date: '2026-08-23' }))).toBe(false);
		expect(isMealInPool(meal('dated-timed', { date: '2026-08-23', time: '18:30' }))).toBe(false);
	});

	test('keeps timed meals before untimed meals and spaces reordered pool positions', () => {
		const meals = [
			meal('late', { date: '2026-08-23', time: '19:00' }),
			meal('untimed-b', { date: '2026-08-23', sortOrder: 2000 }),
			meal('early', { date: '2026-08-23', time: '18:00' }),
			meal('untimed-a', { date: '2026-08-23', sortOrder: 1000 })
		];
		expect(sortScheduledMeals(meals).map(({ id }) => id)).toEqual([
			'early',
			'late',
			'untimed-a',
			'untimed-b'
		]);

		const moved = moveMealToDropTarget(meals, meals[3]!, {
			kind: 'date',
			date: '2026-08-23',
			index: 4
		});
		expect(
			moved
				.filter(({ time }) => !time)
				.toSorted((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
				.map(({ id, sortOrder }) => [id, sortOrder])
		).toEqual([
			['untimed-b', 1000],
			['untimed-a', 2000]
		]);
	});
});
