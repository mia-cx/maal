type SheetScrollElements = {
	viewport?: HTMLElement;
	sheet?: HTMLElement;
	handoffScroll: number;
};

const scrollBy = (element: HTMLElement, deltaY: number): number => {
	const previousScrollTop = element.scrollTop;
	const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
	element.scrollTop = Math.min(maxScrollTop, Math.max(0, previousScrollTop + deltaY));
	return element.scrollTop - previousScrollTop;
};

/** Routes wheel gestures through the sheet's outer travel before scrolling its content. */
export const routeSheetWheel = (
	event: WheelEvent,
	{ viewport, sheet, handoffScroll }: SheetScrollElements
) => {
	if (!viewport || !sheet || !event.cancelable || event.deltaY === 0) return;

	event.preventDefault();

	let remainingDelta = event.deltaY;
	if (remainingDelta > 0) {
		if (viewport.scrollTop < handoffScroll) {
			const consumedByViewport = scrollBy(
				viewport,
				Math.min(remainingDelta, handoffScroll - viewport.scrollTop)
			);
			remainingDelta -= consumedByViewport;
		}
		if (remainingDelta > 0) scrollBy(sheet, remainingDelta);
		return;
	}

	const consumedBySheet = scrollBy(sheet, remainingDelta);
	remainingDelta -= consumedBySheet;
	if (remainingDelta < 0) scrollBy(viewport, remainingDelta);
};
