import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { parseIngredientLine } from '$lib/recipes/ingredient-text';
import {
	fetchRecipeImportPage,
	type RecipeImportFetchOptions,
	type RecipeImportFetchRuntime
} from './recipe-import-fetch';
import { cleanImportedText } from './html-text';

const maxImportBytes = 1_500_000;

type RecipeJson = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const stringValue = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? cleanImportedText(value) : undefined;

const arrayValue = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : value ? [value] : [];

const firstString = (...values: unknown[]): string | undefined => {
	for (const value of values) {
		if (Array.isArray(value)) {
			const nested = firstString(...value);
			if (nested) return nested;
			continue;
		}
		if (isRecord(value)) {
			const nested = firstString(value.name, value.url, value['@id']);
			if (nested) return nested;
			continue;
		}
		const text = stringValue(value);
		if (text) return text;
	}
};

const recipeType = (value: unknown): boolean => {
	const types = arrayValue(value).map((type) => String(type).toLowerCase());
	return (
		types.includes('recipe') ||
		types.includes('schema:recipe') ||
		types.includes('https://schema.org/recipe')
	);
};

const flattenJsonLd = (value: unknown): RecipeJson[] => {
	if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
	if (!isRecord(value)) return [];
	return [value, ...flattenJsonLd(value['@graph'])];
};

const parseJsonLdScripts = (html: string): unknown[] => {
	const scripts = html.matchAll(
		/<script\b(?=[^>]*\btype=["'][^"']*application\/ld\+json[^"']*["'])[^>]*>([\s\S]*?)<\/script>/gi
	);
	const values: unknown[] = [];
	for (const script of scripts) {
		const content = script[1]
			.replace(/<!--/g, '')
			.replace(/-->/g, '')
			.replace(/&quot;/g, '"')
			.trim();
		if (!content) continue;
		try {
			values.push(JSON.parse(content));
		} catch {
			// Ignore unrelated broken JSON-LD snippets.
		}
	}
	return values;
};

const instructionText = (value: unknown): string[] => {
	if (typeof value === 'string') return [cleanImportedText(value)].filter(Boolean);
	if (Array.isArray(value)) return value.flatMap(instructionText);
	if (!isRecord(value)) return [];
	if (recipeType(value['@type']) && value.recipeInstructions) {
		return instructionText(value.recipeInstructions);
	}
	if (String(value['@type']).toLowerCase().includes('howtosection')) {
		return instructionText(value.itemListElement);
	}
	return [firstString(value.text, value.name)].filter((text): text is string => Boolean(text));
};

const durationMinutes = (value: unknown): number | undefined => {
	const text = stringValue(value);
	if (!text) return;
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(text);
	if (!match) return;
	return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
};

const cookMinutesFromRecipe = (recipe: RecipeJson): number | undefined => {
	const cookMinutes = durationMinutes(recipe.cookTime);
	if (cookMinutes !== undefined) return cookMinutes;
	const totalMinutes = durationMinutes(recipe.totalTime);
	if (totalMinutes === undefined) return;
	const prepMinutes = durationMinutes(recipe.prepTime);
	return prepMinutes === undefined ? totalMinutes : Math.max(0, totalMinutes - prepMinutes);
};

const firstNumber = (...values: unknown[]): number | undefined => {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			const match = /\d+(?:\.\d+)?/.exec(value);
			if (match) return Number(match[0]);
		}
	}
};

const siteNameFromUrl = (url: string): string | undefined => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return;
	}
};

type RecipeImportOptions = Pick<RecipeImportFetchOptions, 'fetcher'> & {
	runtime?: RecipeImportFetchRuntime;
};

export const fetchRecipeFromUrlForImport = async (
	url: string,
	options: RecipeImportOptions = {}
): Promise<RecipeMenuItem> => {
	const { html, finalUrl } = await fetchRecipeImportPage(url, maxImportBytes, options);
	const nodes = parseJsonLdScripts(html).flatMap(flattenJsonLd);
	const recipe = nodes.find((node) => recipeType(node['@type']));
	if (!recipe) throw new Error('No schema.org JSON-LD Recipe data found on that page.');

	const ingredients = arrayValue(recipe.recipeIngredient)
		.map((ingredient) => cleanImportedText(String(ingredient)))
		.filter(Boolean)
		.map((ingredient) => parseIngredientLine(ingredient));

	return {
		id: `imported-recipe-${crypto.randomUUID()}`,
		title: firstString(recipe.name, recipe.headline) ?? 'Imported recipe',
		description: stringValue(recipe.description) ?? '',
		image: firstString(recipe.image),
		sourceUrl: finalUrl,
		sourceSiteName: siteNameFromUrl(finalUrl),
		sourceClaimedMinutes: cookMinutesFromRecipe(recipe),
		parseConfidence: 1,
		ingredientConfidence: 1,
		instructionConfidence: 1,
		prepTimeMinutes: durationMinutes(recipe.prepTime),
		cookTimeMinutes: cookMinutesFromRecipe(recipe),
		totalTimeMinutes: durationMinutes(recipe.totalTime),
		yield: firstNumber(recipe.recipeYield, recipe.yield),
		ingredients,
		ingredientCount: ingredients.length,
		instructions: instructionText(recipe.recipeInstructions).map((text, index) => ({
			position: index + 1,
			text
		})),
		appliances: [],
		timesCooked: 0,
		plannedCount: 0,
		reviewSummary: { worthRepeating: 0, neutral: 0, neverAgain: 0, notes: [] }
	};
};
