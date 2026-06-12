import {
	displayIngredientAmount as displayCanonicalIngredientAmount,
	type UnitPreferences
} from '$lib/recipes/ingredient-text';
import type { EffectiveTaxonomyPreferences } from './preferences';

export type TaxonomyIngredient = {
	baseQuantity?: number | null;
	baseUnitId?: string | null;
	baseFoodId?: string | null;
	sourceFoodLabel?: string | null;
	originalText: string;
};

export const displayFoodName = (
	foodId: string | null | undefined,
	fallback: string,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {}
): string => {
	const unitPreferences =
		'unitPreferences' in preferences ? preferences.unitPreferences : preferences;
	return (foodId ? unitPreferences.ingredientNameOverrides?.[foodId] : undefined) ?? fallback;
};

export const displayIngredientAmount = (
	quantity: number | null | undefined,
	baseUnitId: string | null | undefined,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {},
	foodName?: string,
	foodId?: string | null
): string => {
	const unitPreferences =
		'unitPreferences' in preferences ? preferences.unitPreferences : preferences;
	return displayCanonicalIngredientAmount(quantity, baseUnitId, unitPreferences, foodName, foodId);
};

export const displayIngredient = (
	ingredient: TaxonomyIngredient,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {}
): { amount: string; item: string; text: string } => {
	const fallbackItem = ingredient.sourceFoodLabel ?? ingredient.originalText;
	const item = displayFoodName(ingredient.baseFoodId, fallbackItem, preferences);
	const amount = displayIngredientAmount(
		ingredient.baseQuantity,
		ingredient.baseUnitId,
		preferences,
		item,
		ingredient.baseFoodId
	);
	return {
		amount,
		item,
		text: [amount, item].filter(Boolean).join(' ') || ingredient.originalText
	};
};

export const displayIngredientText = (
	ingredient: TaxonomyIngredient,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {}
): string => displayIngredient(ingredient, preferences).text;
