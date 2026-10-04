import { type MealFeedbackVerdict } from '$lib/domain/meal-feedback';
import type { RecipeMenuItem } from '$lib/menu/menu-types';

export type MealLoad = 'low' | 'medium' | 'high';

const lowCookLoadMinutes = 20;
const highCookLoadMinutes = 75;
const unknownRecipeLoadScore = 0.45;

export const menuLoadAccentClasses: Record<MealLoad, string> = {
	low: 'after:bg-meal-load-low',
	medium: 'after:bg-meal-load-medium',
	high: 'after:bg-meal-load-high'
};

export const verdictToneClasses: Record<MealFeedbackVerdict, string> = {
	repeat: 'text-meal-load-low',
	neutral: 'text-meal-load-medium',
	avoid: 'text-meal-load-high'
};

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number): number => {
	const progress = clamp((value - edge0) / (edge1 - edge0));
	return progress * progress * (3 - 2 * progress);
};

const mentalLoadLevel = (score: number): MealLoad => {
	if (score < 0.35) return 'low';
	if (score < 0.7) return 'medium';
	return 'high';
};

export const recipeCookMinutes = (recipe: RecipeMenuItem): number | undefined =>
	recipe.averageActualMinutes ?? recipe.cookTimeMinutes ?? recipe.sourceClaimedMinutes;

const parseDateKey = (dateKey?: string): Date | undefined => {
	if (!dateKey) return;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
	if (!match) return;
	const [, yearText, monthText, dayText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
		return;
	}
	return date;
};

const daysSince = (dateKey?: string): number | undefined => {
	const date = parseDateKey(dateKey);
	if (!date) return;
	const today = new Date();
	return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
};

const usageLoadScore = (recipe: RecipeMenuItem): number => {
	const cookConfidence = smoothstep(0, 8, recipe.timesCooked);
	const planConfidence = smoothstep(0, 12, recipe.plannedCount) * 0.35;
	const recency = daysSince(recipe.lastCookedAt);
	const recencyConfidence = recency === undefined ? 0 : Math.max(0, 1 - recency / 120) * 0.25;
	const positiveVerdict = recipe.latestVerdict === 'repeat' ? 0.2 : 0;
	const negativeVerdict = recipe.latestVerdict === 'avoid' ? 0.55 : 0;
	const knownGoodScore = clamp(
		cookConfidence * 0.6 + planConfidence + recencyConfidence + positiveVerdict
	);
	return clamp(unknownRecipeLoadScore - knownGoodScore * 0.55 + negativeVerdict);
};

export const recipeMentalLoad = (recipe: RecipeMenuItem): MealLoad => {
	const usageScore = usageLoadScore(recipe);
	const cookMinutes = recipeCookMinutes(recipe) ?? lowCookLoadMinutes;
	const timeScore = smoothstep(lowCookLoadMinutes, highCookLoadMinutes, cookMinutes);
	const independentLoad = 1 - (1 - usageScore) ** 0.65 * (1 - timeScore) ** 0.45;
	const interactionLoad = 0.12 * usageScore * timeScore;
	return mentalLoadLevel(clamp(independentLoad + interactionLoad));
};

export const formatMinutes = (minutes?: number): string | undefined => {
	if (minutes == null || Number.isNaN(minutes)) return;
	if (minutes < 60) return `${Math.round(minutes)} min`;
	const roundedMinutes = Math.round(minutes);
	const hours = Math.floor(roundedMinutes / 60);
	const remainingMinutes = roundedMinutes % 60;
	return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
};

export const formatDate = (dateKey?: string): string | undefined => {
	if (!dateKey) return;
	const date = parseDateKey(dateKey);
	if (!date) return dateKey;
	return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
};

export const applianceLabel = (appliance: string): string =>
	appliance
		.split('_')
		.filter(Boolean)
		.map((word) => word[0]!.toUpperCase() + word.slice(1))
		.join(' ');

export const recipePrimaryMetadata = (recipe: RecipeMenuItem): string[] =>
	[formatMinutes(recipeCookMinutes(recipe))].filter((value): value is string => Boolean(value));

export const recipeReviewCount = (recipe: RecipeMenuItem): number =>
	recipe.reviewSummary.worthRepeating +
	recipe.reviewSummary.neutral +
	recipe.reviewSummary.neverAgain;
