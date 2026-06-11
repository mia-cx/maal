import type { MealFamiliarity } from './schedule-types';

export type MealRating = 'repeat' | 'neutral' | 'avoid';
export type MealFeedbackVerdict = MealRating;
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

export const mealFeedbackVerdictLabels: Record<MealFeedbackVerdict, string> = ratingLabels;

export const capacityModeLabels: Record<CapacityMode, string> = {
	adventurous: 'Adventurous',
	normal: 'Normal',
	low: 'Low',
	survival: 'Survival'
};
