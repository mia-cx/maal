import type { EffectiveTaxonomyPreferences, UnitPreferences } from './preferences.js';
import { GLOBAL_UNIT_SEED } from '$lib/domain/taxonomy/global-seed.js';

export type TaxonomyIngredient = {
	baseQuantity?: number | null;
	baseUnitId?: string | null;
	sourceQuantity?: number | null;
	sourceUnitLabel?: string | null;
	baseFoodId?: string | null;
	sourceFoodLabel?: string | null;
	originalText: string;
};

const compactUnitToId: Readonly<Record<string, string>> = {
	g: 'grams',
	kg: 'kilograms',
	mg: 'milligrams',
	oz: 'ounces',
	lb: 'pounds',
	ml: 'milliliters',
	l: 'liters',
	cl: 'centiliters',
	dl: 'deciliters',
	tsp: 'teaspoons',
	tbsp: 'tablespoons',
	cup: 'cups',
	'fl oz': 'fluid_ounces',
	pint: 'pints',
	quart: 'quarts',
	gal: 'gallons',
	each: 'each',
	pinch: 'pinches',
	dash: 'dashes',
	drop: 'drops',
	piece: 'pieces',
	clove: 'cloves',
	slice: 'slices',
	can: 'cans',
	bunch: 'bunches',
	handful: 'handfuls',
	sprig: 'sprigs',
	stalk: 'stalks',
	leaf: 'leaves',
	head: 'heads',
	bulb: 'bulbs',
	jar: 'jars',
	bottle: 'bottles',
	package: 'packages',
	packet: 'packets',
	celsius: 'celsius',
	fahrenheit: 'fahrenheit'
};

const idToCompactUnit = Object.fromEntries(
	Object.entries(compactUnitToId).map(([compact, id]) => [id, compact])
);

const defaultConversions = Object.fromEntries(
	GLOBAL_UNIT_SEED.map((unit) => [
		unit.id,
		{
			baseUnitId: unit.baseUnitId,
			toBaseFactor: unit.toBaseFactor,
			toBaseOffset: unit.toBaseOffset
		}
	])
);

const unitPreferences = (
	preferences: UnitPreferences | EffectiveTaxonomyPreferences
): UnitPreferences =>
	'unitPreferences' in preferences ? preferences.unitPreferences : preferences;

const normalizedUnit = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[.,]+$/g, '');

const canonicalUnit = (value: string, preferences: UnitPreferences): string => {
	const normalized = normalizedUnit(value);
	return idToCompactUnit[value] ?? preferences.unitAliases?.[normalized] ?? normalized;
};

const fractionLabels = new Map([
	['1/2', '½'],
	['1/3', '⅓'],
	['2/3', '⅔'],
	['1/4', '¼'],
	['3/4', '¾'],
	['1/8', '⅛'],
	['3/8', '⅜'],
	['5/8', '⅝'],
	['7/8', '⅞']
]);

const commonDivisor = (left: number, right: number): number =>
	right === 0 ? left : commonDivisor(right, left % right);

const formatQuantity = (quantity: number): string => {
	const rounded = Math.round(quantity * 100) / 100;
	const whole = Math.floor(rounded);
	const fraction = rounded - whole;
	if (fraction < 0.01) return String(whole);
	let numerator = Math.round(fraction * 8);
	let denominator = 8;
	const divisor = commonDivisor(numerator, denominator);
	numerator /= divisor;
	denominator /= divisor;
	const label = fractionLabels.get(`${numerator}/${denominator}`) ?? `${numerator}/${denominator}`;
	return whole > 0 ? `${whole}${label.length === 1 ? '' : ' '}${label}` : label;
};

const isSingular = (quantity: number): boolean => Math.abs(quantity - 1) < 0.0001;

const preferredUnit = (
	baseUnitId: string,
	preferences: UnitPreferences,
	foodId?: string | null
): { unitId: string; label: string; pluralLabel?: string } => {
	const foodOverride = foodId ? preferences.ingredientUnitOverrides?.[foodId] : undefined;
	let compact = foodOverride;
	if (!compact && baseUnitId === 'grams') compact = preferences.preferredMassUnit ?? 'g';
	if (!compact && baseUnitId === 'milliliters') compact = preferences.preferredVolumeUnit ?? 'ml';
	if (!compact && baseUnitId === 'celsius') {
		compact = preferences.preferredTemperatureUnit ?? 'celsius';
	}
	compact ??= idToCompactUnit[baseUnitId] ?? baseUnitId;
	const unitId = compactUnitToId[compact] ?? compact;
	const label =
		(foodId ? preferences.ingredientUnitLabelOverrides?.[foodId] : undefined) ??
		(baseUnitId === 'grams' ? preferences.preferredMassUnitLabel : undefined) ??
		(baseUnitId === 'milliliters' ? preferences.preferredVolumeUnitLabel : undefined) ??
		(baseUnitId === 'celsius' ? preferences.preferredTemperatureUnitLabel : undefined) ??
		preferences.unitLabelOverrides?.[compact] ??
		compact;
	const pluralLabel =
		(foodId ? preferences.ingredientUnitPluralLabelOverrides?.[foodId] : undefined) ??
		(baseUnitId === 'grams' ? preferences.preferredMassUnitPluralLabel : undefined) ??
		(baseUnitId === 'milliliters' ? preferences.preferredVolumeUnitPluralLabel : undefined) ??
		preferences.unitPluralLabelOverrides?.[compact];
	return { unitId, label, pluralLabel };
};

export const displayFoodName = (
	foodId: string | null | undefined,
	fallback: string,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {}
): string => {
	const resolved = unitPreferences(preferences);
	return (foodId ? resolved.ingredientNameOverrides?.[foodId] : undefined) ?? fallback;
};

export const displayIngredientAmount = (
	quantity: number | null | undefined,
	baseUnitId: string | null | undefined,
	preferences: UnitPreferences | EffectiveTaxonomyPreferences = {},
	_foodName?: string,
	foodId?: string | null
): string => {
	if (quantity === null || quantity === undefined || !baseUnitId) return '';
	const resolved = unitPreferences(preferences);
	const sourceUnitId = compactUnitToId[canonicalUnit(baseUnitId, resolved)] ?? baseUnitId;
	const conversions = resolved.unitConversions ?? defaultConversions;
	const source = conversions[sourceUnitId];
	const baseFamily = source?.baseUnitId ?? baseUnitId;
	const target = preferredUnit(baseFamily, resolved, foodId);
	const targetConversion = conversions[target.unitId];
	const baseQuantity = source ? quantity * source.toBaseFactor + source.toBaseOffset : quantity;
	const displayedQuantity = targetConversion
		? (baseQuantity - targetConversion.toBaseOffset) / targetConversion.toBaseFactor
		: baseQuantity;
	const label = isSingular(displayedQuantity) ? target.label : (target.pluralLabel ?? target.label);
	return [formatQuantity(displayedQuantity), label].filter(Boolean).join(' ');
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
