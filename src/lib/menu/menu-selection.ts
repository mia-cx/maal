export type MenuSelectableItem = { id: string };

export const applyMenuSelection = (
	selectedIds: readonly string[],
	ids: readonly string[],
	selected: boolean
): string[] => {
	if (!selected) return selectedIds.filter((id) => !ids.includes(id));
	return [...selectedIds, ...ids.filter((id) => !selectedIds.includes(id))];
};

export const menuRangeIds = <Item extends MenuSelectableItem>(
	items: readonly Item[],
	fromId: string | null,
	toId: string
): string[] => {
	const toIndex = items.findIndex((item) => item.id === toId);
	const fromIndex = fromId ? items.findIndex((item) => item.id === fromId) : -1;
	if (fromIndex < 0 || toIndex < 0) return [toId];
	const start = Math.min(fromIndex, toIndex);
	const end = Math.max(fromIndex, toIndex);
	return items.slice(start, end + 1).map((item) => item.id);
};

export const toggleMenuSelection = <Item extends MenuSelectableItem>({
	items,
	selectedIds,
	lastSelectedId,
	itemId,
	selected,
	range
}: {
	items: readonly Item[];
	selectedIds: readonly string[];
	lastSelectedId: string | null;
	itemId: string;
	selected: boolean;
	range: boolean;
}): string[] =>
	applyMenuSelection(
		selectedIds,
		range && selectedIds.length > 0 ? menuRangeIds(items, lastSelectedId, itemId) : [itemId],
		selected
	);
