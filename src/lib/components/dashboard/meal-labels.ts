import type { MealFamiliarity } from './schedule-types';

export type MealRating = 'repeat' | 'neutral' | 'avoid';
export type MealFeedbackVerdict = 'worth_repeating' | 'neutral' | 'never_again';
export type CapacityMode = 'adventurous' | 'normal' | 'low' | 'survival';

export const familiarityLabels: Record<MealFamiliarity, string> = {
	safe: 'Safe',
	exploration: 'Exploration',
	wildcard: 'Wildcard'
};

export const ratingLabels: Record<MealRating, string> = {
	repeat: 'Worth repeating',
	neutral: 'Indifferent',
	avoid: 'Never again'
};

export const mealFeedbackVerdictLabels: Record<MealFeedbackVerdict, string> = {
	worth_repeating: ratingLabels.repeat,
	neutral: ratingLabels.neutral,
	never_again: ratingLabels.avoid
};

export const capacityModeLabels: Record<CapacityMode, string> = {
	adventurous: 'Adventurous',
	normal: 'Normal',
	low: 'Low',
	survival: 'Survival'
};
