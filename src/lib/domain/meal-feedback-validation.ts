import { mealFeedbackVerdictSet, type MealFeedbackVerdict } from './meal-feedback';

export const parseRequiredText = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text || null;
};

export const parseMealFeedbackVerdict = (value: unknown): MealFeedbackVerdict | null =>
	typeof value === 'string' && mealFeedbackVerdictSet.has(value as MealFeedbackVerdict)
		? (value as MealFeedbackVerdict)
		: null;

export const parseOptionalBoolean = (value: unknown, fallback: boolean): boolean | null => {
	if (value === undefined || value === null) return fallback;
	return typeof value === 'boolean' ? value : null;
};

export const parseOptionalPositiveInteger = (value: unknown): number | null => {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
	if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
