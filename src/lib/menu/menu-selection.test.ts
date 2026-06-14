import { describe, expect, it } from 'vitest';
import { applyMenuSelection, menuRangeIds, toggleMenuSelection } from '$lib/menu/menu-selection';

const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('menu selection helpers', () => {
	it('adds only newly selected ids', () => {
		expect(applyMenuSelection(['a'], ['a', 'b'], true)).toEqual(['a', 'b']);
	});

	it('removes selected ids', () => {
		expect(applyMenuSelection(['a', 'b', 'c'], ['b'], false)).toEqual(['a', 'c']);
	});

	it('returns a contiguous range between ids', () => {
		expect(menuRangeIds(items, 'b', 'd')).toEqual(['b', 'c', 'd']);
		expect(menuRangeIds(items, 'd', 'b')).toEqual(['b', 'c', 'd']);
	});

	it('falls back to the target id when range anchors are missing', () => {
		expect(menuRangeIds(items, null, 'c')).toEqual(['c']);
		expect(menuRangeIds(items, 'x', 'c')).toEqual(['c']);
		expect(menuRangeIds(items, 'a', 'x')).toEqual(['x']);
	});

	it('toggles ranges only when range selection has an existing selection', () => {
		expect(
			toggleMenuSelection({
				items,
				selectedIds: ['b'],
				lastSelectedId: 'b',
				itemId: 'd',
				selected: true,
				range: true
			})
		).toEqual(['b', 'c', 'd']);

		expect(
			toggleMenuSelection({
				items,
				selectedIds: [],
				lastSelectedId: 'b',
				itemId: 'd',
				selected: true,
				range: true
			})
		).toEqual(['d']);
	});
});
