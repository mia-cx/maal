import type { MealFeedbackVerdict } from '$lib/components/dashboard/meal-labels';

export type RecipeIngredientItem = {
	amount: string;
	unit?: string;
	item: string;
};

export type RecipeInstructionItem = {
	position: number;
	text: string;
};

export type RecipeMenuItem = {
	id: string;
	title: string;
	description: string;
	image?: string;
	sourceSiteName?: string;
	sourceAuthorName?: string;
	sourcePublisherName?: string;
	sourceIsBasedOnUrl?: string;
	sourceUrl?: string;
	sourceImportedAt?: string;
	sourceClaimedMinutes?: number;
	averageActualMinutes?: number;
	parseConfidence?: number;
	ingredientConfidence?: number;
	instructionConfidence?: number;
	nutritionConfidence?: number;
	timeRealismConfidence?: number;
	userNotes?: string;
	prepTimeMinutes?: number;
	cookTimeMinutes?: number;
	totalTimeMinutes?: number;
	yield?: number;
	ingredients?: RecipeIngredientItem[];
	instructions?: RecipeInstructionItem[];
	ingredientCount: number;
	appliances: string[];
	dietTags?: string[];
	timesCooked: number;
	plannedCount: number;
	lastCookedAt?: string;
	latestVerdict?: MealFeedbackVerdict;
	reviewSummary: {
		worthRepeating: number;
		neutral: number;
		neverAgain: number;
		notes: string[];
	};
};
