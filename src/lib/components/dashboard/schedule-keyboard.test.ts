import { describe, expect, it } from 'vitest';
import { nextMealCard } from './schedule-keyboard';

const card = (left: number, top: number): HTMLElement =>
	({
		getBoundingClientRect: () => ({
			left,
			top,
			width: 10,
			height: 10,
			right: left + 10,
			bottom: top + 10,
			x: left,
			y: top,
			toJSON: () => ({})
		})
	}) as HTMLElement;

describe('nextMealCard', () => {
	it('chooses the nearest card in the requested direction', () => {
		const active = card(10, 10);
		const right = card(40, 12);
		const fartherRight = card(80, 10);
		const below = card(10, 40);
		expect(nextMealCard([active, fartherRight, right, below], active, 'right')).toBe(right);
		expect(nextMealCard([active, fartherRight, right, below], active, 'down')).toBe(below);
	});

	it('ignores cards behind the requested direction', () => {
		const active = card(40, 40);
		const left = card(10, 40);
		expect(nextMealCard([active, left], active, 'right')).toBeUndefined();
	});
});
