export const normalizeServingsPlanned = (
	meal: { servingsPlanned?: number | null },
	defaultServings = 1
): number => {
	const servings = meal.servingsPlanned ?? defaultServings;
	return Number.isFinite(servings) ? Math.max(1, Math.round(servings)) : 1;
};
