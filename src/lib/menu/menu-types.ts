import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';
import type { RecipeImportedCandidate } from '$lib/domain/recipes/schema.js';

export type RecipeIngredientItem = {
	id?: string;
	amount: string;
	unit?: string;
	item: string;
};

export type RecipeInstructionItem = {
	id?: string;
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
	archivedAt?: string;
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
	/** Decoded remote candidate retained until the user confirms Save; never used as storage. */
	importedCandidate?: RecipeImportedCandidate;
};
