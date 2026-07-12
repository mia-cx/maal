import type { MealFamiliarity } from './schedule-types';
import type { CapacityMode, MealFeedbackVerdict, MealRating } from '$lib/domain/meal-feedback';

export type { CapacityMode, MealFeedbackVerdict, MealRating };

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
