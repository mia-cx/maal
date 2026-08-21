export type CardDirection = 'left' | 'right' | 'up' | 'down';

export const cardDirectionByKey: Record<string, CardDirection> = {
	ArrowLeft: 'left',
	ArrowRight: 'right',
	ArrowUp: 'up',
	ArrowDown: 'down',
	h: 'left',
	l: 'right',
	k: 'up',
	j: 'down'
};

export const visibleMealCards = (): HTMLElement[] =>
	Array.from(document.querySelectorAll<HTMLElement>('[data-meal-card-id]')).filter((card) => {
		const rect = card.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && getComputedStyle(card).visibility !== 'hidden';
	});

export const nextMealCard = (
	cards: HTMLElement[],
	activeCard: HTMLElement,
	direction: CardDirection
): HTMLElement | undefined => {
	const activeRect = activeCard.getBoundingClientRect();
	const activeX = activeRect.left + activeRect.width / 2;
	const activeY = activeRect.top + activeRect.height / 2;
	const horizontal = direction === 'left' || direction === 'right';
	const forward = direction === 'right' || direction === 'down';

	return cards
		.filter((card) => card !== activeCard)
		.map((card) => {
			const rect = card.getBoundingClientRect();
			const x = rect.left + rect.width / 2;
			const y = rect.top + rect.height / 2;
			const primaryDelta = horizontal
				? forward
					? x - activeX
					: activeX - x
				: forward
					? y - activeY
					: activeY - y;
			const crossDelta = horizontal ? Math.abs(y - activeY) : Math.abs(x - activeX);
			return { card, primaryDelta, score: primaryDelta + crossDelta * 1.5 };
		})
		.filter((candidate) => candidate.primaryDelta > 2)
		.sort((left, right) => left.score - right.score)[0]?.card;
};

export const focusMealCard = (activeCard: HTMLElement, direction: CardDirection) => {
	const nextCard = nextMealCard(visibleMealCards(), activeCard, direction);
	if (!nextCard) return;
	nextCard.focus({ preventScroll: true });
	nextCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
};
