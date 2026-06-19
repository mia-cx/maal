import {
	displayIngredientAmount as displayCanonicalIngredientAmount,
	type UnitPreferences
} from '$lib/recipes/ingredient-text';
import type { EffectiveTaxonomyPreferences } from './preferences';

export type TaxonomyIngredient = {
	baseQuantity?: number | null;
	baseUnitId?: string | null;
	sourceQuantity?: number | null;
	sourceUnitLabel?: string | null;
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

const defaultUnitForFood = (foodName: string): string | undefined => {
	const normalized = foodName.toLowerCase().trim();
	if (normalized === 'garlic' || normalized === 'knoflook') return 'clove';
};

export const displayIngredient = (
	ingredient: TaxonomyIngredient,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {}
): { amount: string; item: string; text: string } => {
	const fallbackItem = ingredient.sourceFoodLabel ?? ingredient.originalText;
	const item = displayFoodName(ingredient.baseFoodId, fallbackItem, preferences);
	const quantity = ingredient.baseQuantity ?? ingredient.sourceQuantity;
	const unit = ingredient.baseUnitId ?? ingredient.sourceUnitLabel ?? defaultUnitForFood(item);
	const amount = displayIngredientAmount(quantity, unit, preferences, item, ingredient.baseFoodId);
	const text = [amount, item].filter(Boolean).join(' ');
	const originalAmount =
		!amount && item && ingredient.originalText.endsWith(item)
			? ingredient.originalText.slice(0, -item.length).trim()
			: '';
	return {
		amount,
		item,
		text: originalAmount ? ingredient.originalText : text || ingredient.originalText
	};
};

export const displayIngredientText = (
	ingredient: TaxonomyIngredient,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {}
): string => displayIngredient(ingredient, preferences).text;
