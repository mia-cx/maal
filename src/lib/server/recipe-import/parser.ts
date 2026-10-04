import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	RecipeImportedCandidateSchema,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';

import { fetchRecipePage } from './fetch.js';

type JsonObject = Record<string, unknown>;

export class RecipeImportParseError extends Error {
	readonly _tag = 'RecipeImportParseError';
	constructor(readonly code: 'recipe_not_found' | 'candidate_invalid') {
		super(code);
	}
}

const record = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const clean = (value: string): string =>
	value
		.replace(/<[^>]*>/g, ' ')
		.replaceAll('&nbsp;', ' ')
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replace(/\s+/g, ' ')
		.trim();

const text = (value: unknown): string | null =>
	typeof value === 'string' && clean(value) ? clean(value) : null;

const values = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

const firstText = (...candidates: unknown[]): string | null => {
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			const nested = firstText(...candidate);
			if (nested) return nested;
		} else if (record(candidate)) {
			const nested = firstText(candidate.name, candidate.url, candidate['@id']);
			if (nested) return nested;
		} else {
			const found = text(candidate);
			if (found) return found;
		}
	}
	return null;
};

const isRecipe = (value: unknown): boolean =>
	values(value)
		.map((item) => String(item).toLowerCase())
		.some((item) => ['recipe', 'schema:recipe', 'https://schema.org/recipe'].includes(item));

const flatten = (value: unknown): JsonObject[] => {
	if (Array.isArray(value)) return value.flatMap(flatten);
	if (!record(value)) return [];
	return [value, ...flatten(value['@graph'])];
};

const jsonLd = (html: string): unknown[] => {
	const scripts = html.matchAll(
		/<script\b(?=[^>]*\btype=["'][^"']*application\/ld\+json[^"']*["'])[^>]*>([\s\S]*?)<\/script>/gi
	);
	const parsed: unknown[] = [];
	for (const match of scripts) {
		const source = match[1]
			?.replaceAll('<!--', '')
			.replaceAll('-->', '')
			.replaceAll('&quot;', '"')
			.trim();
		if (!source) continue;
		try {
			parsed.push(JSON.parse(source));
		} catch {
			// Ignore malformed unrelated JSON-LD blocks.
		}
	}
	return parsed;
};

const duration = (value: unknown): number | null => {
	const source = text(value);
	if (!source) return null;
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(source);
	return match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : null;
};

const number = (...candidates: unknown[]): number | null => {
	for (const candidate of candidates) {
		if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
		if (typeof candidate === 'string') {
			const match = /\d+(?:\.\d+)?/.exec(candidate);
			if (match) return Number(match[0]);
		}
	}
	return null;
};

const instructions = (value: unknown): string[] => {
	if (typeof value === 'string') return clean(value) ? [clean(value)] : [];
	if (Array.isArray(value)) return value.flatMap(instructions);
	if (!record(value)) return [];
	if (String(value['@type']).toLowerCase().includes('howtosection')) {
		return instructions(value.itemListElement);
	}
	const found = firstText(value.text, value.name);
	return found ? [found] : [];
};

const sha256 = async (value: string): Promise<string> =>
	[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');

const siteName = (url: string): string => new URL(url).hostname.replace(/^www\./, '');

export const parseRecipeCandidate = async (input: {
	html: string;
	finalUrl: string;
	now?: `${string}Z`;
}): Promise<RecipeImportedCandidate> => {
	const recipe = jsonLd(input.html)
		.flatMap(flatten)
		.find((node) => isRecipe(node['@type']));
	if (!recipe) throw new RecipeImportParseError('recipe_not_found');
	const now = input.now ?? (new Date().toISOString() as `${string}Z`);
	const ingredientLines = values(recipe.recipeIngredient)
		.map((value) => firstText(value))
		.filter((value): value is string => value !== null);
	const instructionLines = instructions(recipe.recipeInstructions);
	const imageUrl = firstText(recipe.image);
	const categories = [
		...values(recipe.recipeCategory).map((value) => ['category', value] as const),
		...values(recipe.recipeCuisine).map((value) => ['cuisine', value] as const),
		...values(recipe.keywords)
			.flatMap((value) => (typeof value === 'string' ? value.split(',') : [value]))
			.map((value) => ['keyword', value] as const)
	];
	const candidate = {
		savedFromHouseholdId: null,
		title: firstText(recipe.name, recipe.headline) ?? 'Imported recipe',
		description: text(recipe.description),
		imageUrl,
		prepTimeMinutes: duration(recipe.prepTime),
		cookTimeMinutes: duration(recipe.cookTime),
		totalTimeMinutes: duration(recipe.totalTime),
		yield: number(recipe.recipeYield, recipe.yield),
		sourceYieldText: firstText(recipe.recipeYield),
		sourceClaimedMinutes: duration(recipe.cookTime) ?? duration(recipe.totalTime),
		sourceDatePublished: text(recipe.datePublished),
		sourceDateModified: text(recipe.dateModified),
		sourceLanguage: firstText(recipe.inLanguage),
		sourceUrl: input.finalUrl,
		sourceSiteName: siteName(input.finalUrl),
		sourceAuthorName: firstText(recipe.author),
		sourcePublisherName: firstText(recipe.publisher),
		sourceIsBasedOnUrl: firstText(recipe.isBasedOn, recipe.isBasedOnUrl),
		sourceImportedAt: now,
		sourceHtmlHash: await sha256(input.html),
		sourceRatingValue: record(recipe.aggregateRating)
			? number(recipe.aggregateRating.ratingValue)
			: null,
		sourceRatingCount: record(recipe.aggregateRating)
			? number(recipe.aggregateRating.ratingCount)
			: null,
		sourceReviewCount: record(recipe.aggregateRating)
			? number(recipe.aggregateRating.reviewCount)
			: null,
		parseConfidence: 1,
		ingredientConfidence: ingredientLines.length > 0 ? 1 : null,
		instructionConfidence: instructionLines.length > 0 ? 1 : null,
		nutritionConfidence: recipe.nutrition ? 1 : null,
		userNotes: null,
		ingredients: ingredientLines.map((line, lineIndex) => ({
			id: uuidv7(),
			lineIndex,
			originalText: line,
			sourceAmountText: null,
			sourceQuantity: null,
			sourceUnitLabel: null,
			sourceFoodLabel: line,
			baseFoodId: null,
			baseQuantity: null,
			baseUnitId: null,
			baseUnitFamilyId: null,
			optional: /\boptional\b/i.test(line),
			confidence: 1,
			createdAt: now
		})),
		instructions: instructionLines.map((line, stepIndex) => ({
			id: uuidv7(),
			stepIndex,
			sectionName: null,
			text: line,
			durationMinutes: null,
			confidence: 1,
			createdAt: now,
			updatedAt: now
		})),
		instructionEvents: [],
		applianceRequirements: [],
		classifications: categories
			.map(([kind, value]) => [kind, firstText(value)] as const)
			.filter((entry): entry is readonly [(typeof entry)[0], string] => entry[1] !== null)
			.map(([kind, value]) => ({
				id: uuidv7(),
				kind,
				value,
				normalizedValue: value.toLocaleLowerCase(),
				schemaOrgValue: value,
				locale: 'en',
				confidence: 1,
				createdAt: now
			})),
		media: imageUrl
			? [
					{
						id: uuidv7(),
						kind: 'image' as const,
						position: 0,
						url: imageUrl,
						contentUrl: null,
						embedUrl: null,
						thumbnailUrl: null,
						name: null,
						caption: null,
						createdAt: now
					}
				]
			: [],
		nutritionFacts: []
	};
	try {
		return Schema.decodeUnknownSync(RecipeImportedCandidateSchema)(candidate);
	} catch {
		throw new RecipeImportParseError('candidate_invalid');
	}
};

export const fetchRecipeCandidate = async (
	url: string,
	options: Parameters<typeof fetchRecipePage>[1] = {}
): Promise<RecipeImportedCandidate> => parseRecipeCandidate(await fetchRecipePage(url, options));
