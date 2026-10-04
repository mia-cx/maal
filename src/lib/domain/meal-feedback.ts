export type MealRating = 'repeat' | 'neutral' | 'avoid';
export type MealFeedbackVerdict = MealRating;
export type CapacityMode = 'adventurous' | 'normal' | 'low' | 'survival';

export const mealFeedbackVerdicts = [
	'repeat',
	'neutral',
	'avoid'
] as const satisfies readonly MealFeedbackVerdict[];
export const mealFeedbackVerdictSet = new Set<MealFeedbackVerdict>(mealFeedbackVerdicts);
