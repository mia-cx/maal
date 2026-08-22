const protectedBlankTargetSelector = [
	'button',
	'a',
	'input',
	'textarea',
	'select',
	'[contenteditable=""]',
	'[contenteditable="true"]',
	'[data-meal-card-id]'
].join(', ');

export const isProtectedScheduleTarget = (target: EventTarget | null): boolean =>
	target instanceof Element && Boolean(target.closest(protectedBlankTargetSelector));

export const handleBlankScheduleTarget = (
	event: MouseEvent,
	dayKey: string,
	onAddMeal?: (date?: string) => void
) => {
	if (isProtectedScheduleTarget(event.target)) return;
	event.stopPropagation();
	onAddMeal?.(dayKey);
};
