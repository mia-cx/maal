import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';

export type MealFamiliarity = 'safe' | 'exploration' | 'wildcard';
export type MealStatus = 'planned' | 'cooked' | 'skipped';

export type MealCheckIn = {
	verdict: MealFeedbackVerdict;
	cookTime?: number;
	reason?: string;
};

export type HouseholdMember = {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: string;
};

export type Meal = {
	id: string;
	userRecipeId?: string;
	title: string;
	day?: string;
	date?: string;
	time?: string;
	sortOrder?: number;
	status?: MealStatus;
	plannedCookWorkosUserId?: string;
	prepTimeMinutes?: number;
	cookTimeMinutes?: number;
	adjustedCookTimeMinutes?: number;
	servingsPlanned?: number;
	baseServings?: number;
	familiarity?: MealFamiliarity;
	image?: string;
	description?: string;
	ingredients?: string[];
	instructions?: string[];
	latestVerdict?: MealFeedbackVerdict;
	latestCheckIn?: MealCheckIn;
};
