import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { requireAppContext } from '$lib/server/http/app-context';
import { getDb } from '$lib/server/db';
import {
	householdMeals,
	householdMealUserRecipes,
	households,
	unitAliases,
	userRecipeClassifications,
	userRecipeMedia,
	userRecipeNutritionFacts,
	userRecipes
} from '$lib/server/db/schema';
import {
	loadMenuRecipes,
	schemaOrgFromRecipeItem,
	updateRecipeIngredients,
	updateRecipeInstructions
} from '$lib/server/db/recipe-mappers';
import type {
	RecipeIngredientItem,
	RecipeInstructionItem,
	RecipeMenuItem
} from '$lib/components/menu/menu-types';
import {
	canonicalIngredientUnit,
	convertInstructionTemperatures,
	parseIngredientLine,
	type IngredientUnitAliases,
	type UnitPreferences
} from '$lib/recipes/ingredient-text';
import { MENU_RECIPE_PAGE_SIZE } from '$lib/menu/pagination';
import { emptyRecipeMenuStats } from '$lib/menu/recipe-defaults';
import { rankRecipesByRelevance } from '$lib/menu/recipe-ranking';
import { boundedPagination } from '$lib/shared/pagination';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import { cleanImportedText } from '$lib/server/services/html-text';

const fallbackTitle = 'Untitled recipe';
const maxTitleLength = 160;
const maxUrlLength = 2048;
const maxImportBytes = 1_500_000;
const defaultRecipePageSize = MENU_RECIPE_PAGE_SIZE;
const maxRecipePageSize = 60;
const maxClassificationRowsPerInsert = 12;
const maxMediaRowsPerInsert = 10;
const maxNutritionRowsPerInsert = 10;

type RecipeJson = Record<string, unknown>;

type CreateRecipeBody = {
	title?: string;
	url?: string;
	recipe?: RecipeMenuItem;
};

type RecipeIdentity = {
	id: string;
	title: string;
	sourceUrl?: string | null;
	sourceIsBasedOnUrl?: string | null;
};

type BulkRecipeBody = {
	recipeIds: string[];
	permanent?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const stringValue = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? cleanImportedText(value) : undefined;

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

const arrayValue = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : value ? [value] : [];

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

const hasType = (node: RecipeJson, type: string): boolean =>
	arrayValue(node['@type']).some((candidate) => String(candidate).toLowerCase() === type);

const nodeId = (node: RecipeJson): string | undefined => stringValue(node['@id']);

const resolveNode = (value: unknown, nodes: RecipeJson[]): RecipeJson | undefined => {
	if (isRecord(value)) {
		const id = stringValue(value['@id']);
		return id ? nodes.find((node) => nodeId(node) === id) : value;
	}
	const id = stringValue(value);
	return id ? nodes.find((node) => nodeId(node) === id) : undefined;
};

const namedReference = (
	value: unknown,
	nodes: RecipeJson[],
	seen = new Set<string>()
): string | undefined => {
	if (Array.isArray(value)) {
		for (const item of value) {
			const name = namedReference(item, nodes, seen);
			if (name) return name;
		}
		return;
	}
	if (typeof value === 'string') {
		const node = resolveNode(value, nodes);
		return node ? namedReference(node, nodes, seen) : stringValue(value);
	}
	if (!isRecord(value)) return;
	const directName = stringValue(value.name);
	if (directName) return directName;
	const id = stringValue(value['@id']);
	if (!id || seen.has(id)) return;
	seen.add(id);
	const node = resolveNode(value, nodes);
	return node && node !== value ? namedReference(node, nodes, seen) : undefined;
};

const compactStrings = (value: unknown, limit = 24): string[] =>
	arrayValue(value)
		.flatMap((item) => {
			const text = firstString(item);
			return text ? [text] : [];
		})
		.slice(0, limit);

const compactValue = (value: unknown, limit = 24): string | string[] | undefined => {
	const values = compactStrings(value, limit);
	if (!values.length) return;
	return values.length === 1 ? values[0] : values;
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
			// Ignore non-parseable JSON-LD blocks; many pages include unrelated broken snippets.
		}
	}
	return values;
};

const compactRecipeInstructions = (value: unknown): RecipeJson[] =>
	instructionText(value).map((text, index) => ({
		'@type': 'HowToStep',
		position: index + 1,
		text
	}));

const compactNutrition = (value: unknown): RecipeJson | undefined => {
	if (!isRecord(value)) return;
	const nutrition: RecipeJson = { '@type': 'NutritionInformation' };
	for (const key of [
		'servingSize',
		'calories',
		'carbohydrateContent',
		'cholesterolContent',
		'proteinContent',
		'fatContent',
		'fiberContent',
		'saturatedFatContent',
		'sodiumContent',
		'sugarContent',
		'transFatContent',
		'unsaturatedFatContent'
	]) {
		const text = stringValue(value[key]);
		if (text) nutrition[key] = text;
	}
	return Object.keys(nutrition).length > 1 ? nutrition : undefined;
};

const compactRecipe = (recipe: RecipeJson, nodes: RecipeJson[], sourceUrl: string): RecipeJson => {
	const authorName = namedReference(recipe.author ?? recipe.creator, nodes);
	const publisherName =
		namedReference(recipe.publisher, nodes) ??
		namedReference(
			nodes.find((node) => hasType(node, 'organization')),
			nodes
		);
	return {
		'@context': 'https://schema.org',
		'@type': 'Recipe',
		name: firstString(recipe.name, recipe.headline) ?? 'Imported recipe',
		description: stringValue(recipe.description),
		datePublished: stringValue(recipe.datePublished),
		dateModified: stringValue(recipe.dateModified),
		inLanguage: firstString(recipe.inLanguage),
		image: compactValue(recipe.image, 4),
		url: firstString(recipe.url, recipe.mainEntityOfPage, sourceUrl) ?? sourceUrl,
		author: authorName ? { '@type': 'Person', name: authorName } : undefined,
		publisher: publisherName ? { '@type': 'Organization', name: publisherName } : undefined,
		recipeYield: compactValue(recipe.recipeYield ?? recipe.yield, 8),
		prepTime: stringValue(recipe.prepTime),
		cookTime: stringValue(recipe.cookTime),
		totalTime: stringValue(recipe.totalTime),
		recipeIngredient: compactStrings(recipe.recipeIngredient, 120),
		recipeInstructions: compactRecipeInstructions(recipe.recipeInstructions),
		recipeCategory: compactValue(recipe.recipeCategory, 12),
		recipeCuisine: compactValue(recipe.recipeCuisine, 12),
		keywords: compactValue(recipe.keywords, 32),
		suitableForDiet: compactValue(recipe.suitableForDiet, 12),
		aggregateRating: isRecord(recipe.aggregateRating)
			? {
					ratingValue: firstString(recipe.aggregateRating.ratingValue),
					ratingCount: firstString(recipe.aggregateRating.ratingCount),
					reviewCount: firstString(recipe.aggregateRating.reviewCount)
				}
			: undefined,
		nutrition: compactNutrition(recipe.nutrition),
		isBasedOn: firstString(recipe.isBasedOn, recipe.isBasedOnUrl)
	};
};

const recipeFromJsonLd = (
	html: string,
	sourceUrl: string
): { recipe: RecipeJson; nodes: RecipeJson[] } | undefined => {
	const nodes = parseJsonLdScripts(html).flatMap(flattenJsonLd);
	const recipe = nodes.find((node) => recipeType(node['@type']));
	if (recipe) return { recipe: compactRecipe(recipe, nodes, sourceUrl), nodes };
};

const siteNameFromUrl = (url: string): string | undefined => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return;
	}
};

const fetchRecipeFromUrl = async (url: string) => {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		error(400, { message: 'Enter a valid recipe URL.' });
	}
	if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
		error(400, { message: 'Enter a valid recipe URL.' });
	}

	let response: Response;
	try {
		response = await fetch(parsedUrl, {
			headers: {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'accept-language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
				'user-agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
			}
		});
	} catch {
		error(502, { message: 'Could not fetch that recipe page.' });
	}
	if (!response.ok) error(502, { message: 'Could not fetch that recipe page.' });

	let html: string;
	try {
		html = (await response.text()).slice(0, maxImportBytes);
	} catch {
		error(502, { message: 'Could not read that recipe page.' });
	}
	const imported = recipeFromJsonLd(html, url);
	if (!imported) error(422, { message: 'No schema.org Recipe data found on that page.' });

	const recipe = imported.recipe;
	const sourceAuthorName = namedReference(recipe.author, imported.nodes);
	const sourcePublisherName = namedReference(recipe.publisher, imported.nodes);
	return {
		recipe,
		sourceSiteName: sourcePublisherName ?? siteNameFromUrl(url),
		sourceAuthorName,
		sourcePublisherName,
		sourceIsBasedOnUrl: firstString(recipe.isBasedOn),
		sourceUrl: url
	};
};

const minimalRecipe = (title: string): RecipeJson => ({
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: title
});

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

const ratingValue = (value: unknown, key: string): number | undefined => {
	if (!isRecord(value)) return;
	return firstNumber(value[key]);
};

const instructionText = (value: unknown): string[] => {
	if (typeof value === 'string') return [cleanImportedText(value)].filter(Boolean);
	if (Array.isArray(value)) return value.flatMap(instructionText);
	if (!isRecord(value)) return [];
	if (recipeType(value['@type']) && value.recipeInstructions)
		return instructionText(value.recipeInstructions);
	if (String(value['@type']).toLowerCase().includes('howtosection')) {
		return instructionText(value.itemListElement);
	}
	return [firstString(value.text, value.name)].filter((text): text is string => Boolean(text));
};

const ingredientsFromRecipe = (
	recipe: RecipeJson,
	unitAliasMap: IngredientUnitAliases = {}
): RecipeIngredientItem[] =>
	arrayValue(recipe.recipeIngredient)
		.map((ingredient) => cleanImportedText(String(ingredient)))
		.filter(Boolean)
		.map((ingredient) => parseIngredientLine(ingredient, unitAliasMap));

const instructionsFromRecipe = (recipe: RecipeJson): RecipeInstructionItem[] =>
	instructionText(recipe.recipeInstructions).map((text, index) => ({ position: index + 1, text }));

const normalizedValue = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const sourceStrings = (value: unknown): string[] =>
	arrayValue(value)
		.flatMap((item) => {
			const text = firstString(item);
			return text ? [text] : [];
		})
		.filter(Boolean);

const saveRecipeClassifications = async (
	db: ReturnType<typeof getDb>,
	userRecipeId: string,
	recipe: RecipeJson
) => {
	const entries = [
		...sourceStrings(recipe.recipeCategory).map((value) => ({ kind: 'category' as const, value })),
		...sourceStrings(recipe.recipeCuisine).map((value) => ({ kind: 'cuisine' as const, value })),
		...sourceStrings(recipe.keywords).map((value) => ({ kind: 'keyword' as const, value })),
		...sourceStrings(recipe.suitableForDiet).map((value) => ({
			kind: 'diet' as const,
			value,
			schemaOrgValue: value
		}))
	];
	if (!entries.length) return;
	const rows = entries.map((entry) => ({
		userRecipeId,
		kind: entry.kind,
		value: entry.value,
		normalizedValue: normalizedValue(entry.value),
		schemaOrgValue: 'schemaOrgValue' in entry ? entry.schemaOrgValue : null,
		confidence: 1
	}));
	for (let index = 0; index < rows.length; index += maxClassificationRowsPerInsert) {
		await db
			.insert(userRecipeClassifications)
			.values(rows.slice(index, index + maxClassificationRowsPerInsert));
	}
};

const mediaRecord = (value: unknown): RecipeJson | undefined => {
	if (typeof value === 'string') return { url: value };
	return isRecord(value) ? value : undefined;
};

const saveRecipeMedia = async (
	db: ReturnType<typeof getDb>,
	userRecipeId: string,
	recipe: RecipeJson
) => {
	const images = arrayValue(recipe.image).flatMap((item) => {
		const image = mediaRecord(item);
		return image ? [image] : [];
	});
	const videos = arrayValue(recipe.video).flatMap((item) => {
		const video = mediaRecord(item);
		return video ? [video] : [];
	});
	const media = [
		...images.map((image, position) => ({
			userRecipeId,
			kind: 'image' as const,
			position,
			url: firstString(image.url, image['@id']),
			contentUrl: firstString(image.contentUrl),
			thumbnailUrl: firstString(image.thumbnailUrl),
			name: firstString(image.name),
			caption: firstString(image.caption)
		})),
		...videos.map((video, position) => ({
			userRecipeId,
			kind: 'video' as const,
			position,
			url: firstString(video.url, video['@id']),
			contentUrl: firstString(video.contentUrl),
			embedUrl: firstString(video.embedUrl),
			thumbnailUrl: firstString(video.thumbnailUrl),
			name: firstString(video.name),
			caption: firstString(video.description, video.caption)
		}))
	];
	for (let index = 0; index < media.length; index += maxMediaRowsPerInsert) {
		await db.insert(userRecipeMedia).values(media.slice(index, index + maxMediaRowsPerInsert));
	}
};

const nutritionProperties = {
	calories: 'calories',
	carbohydrateContent: 'carbohydrate',
	cholesterolContent: 'cholesterol',
	fatContent: 'fat',
	fiberContent: 'fiber',
	proteinContent: 'protein',
	saturatedFatContent: 'saturated_fat',
	servingSize: 'serving_size',
	sodiumContent: 'sodium',
	sugarContent: 'sugar',
	transFatContent: 'trans_fat',
	unsaturatedFatContent: 'unsaturated_fat'
} as const;

const parseNutritionAmount = (value: string) => {
	const match = /(\d+(?:[.,]\d+)?)\s*([a-zA-Zµμ%]+)?/.exec(value);
	return match
		? { amount: Number(match[1].replace(',', '.')), unit: match[2]?.toLowerCase() }
		: { amount: undefined, unit: undefined };
};

const saveRecipeNutritionFacts = async (
	db: ReturnType<typeof getDb>,
	userRecipeId: string,
	recipe: RecipeJson
) => {
	const nutrition = recipe.nutrition;
	if (!isRecord(nutrition)) return;
	const facts = Object.entries(nutritionProperties).flatMap(([schemaOrgProperty, nutrient]) => {
		const originalText = firstString(nutrition[schemaOrgProperty]);
		if (!originalText) return [];
		const parsed = parseNutritionAmount(originalText);
		return [
			{
				userRecipeId,
				nutrient,
				schemaOrgProperty,
				originalText,
				amount: parsed.amount,
				baseAmount: parsed.amount,
				confidence: parsed.amount === undefined ? 0.4 : 0.8
			}
		];
	});
	for (let index = 0; index < facts.length; index += maxNutritionRowsPerInsert) {
		await db
			.insert(userRecipeNutritionFacts)
			.values(facts.slice(index, index + maxNutritionRowsPerInsert));
	}
};

const saveRecipeSidecars = async (
	db: ReturnType<typeof getDb>,
	userRecipeId: string,
	recipe: RecipeJson
) => {
	await Promise.all([
		saveRecipeClassifications(db, userRecipeId, recipe),
		saveRecipeMedia(db, userRecipeId, recipe),
		saveRecipeNutritionFacts(db, userRecipeId, recipe)
	]);
};

const recipeBody = (value: unknown): RecipeMenuItem | undefined => {
	if (!isRecord(value) || typeof value.title !== 'string') return;
	return value as RecipeMenuItem;
};

const urlKeys = (value?: string | null): string[] => {
	const trimmed = value?.trim();
	if (!trimmed) return [];
	try {
		const url = new URL(trimmed);
		url.hash = '';
		url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
		const pathname = url.pathname.replace(/\/+$/, '') || '/';
		const searchParams = new URLSearchParams(url.search);
		for (const key of [...searchParams.keys()]) {
			if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) searchParams.delete(key);
		}
		searchParams.sort();
		const search = searchParams.toString();
		return [
			`${url.hostname}${pathname}${search ? `?${search}` : ''}`,
			`${url.hostname}${pathname}`
		];
	} catch {
		return [trimmed.toLowerCase()];
	}
};

const addUrlKeys = (keys: Set<string>, value?: string | null) => {
	for (const key of urlKeys(value)) keys.add(key);
};

const recipeUrlKeys = (recipe: RecipeIdentity): Set<string> => {
	const keys = new Set<string>();
	addUrlKeys(keys, recipe.sourceUrl);
	addUrlKeys(keys, recipe.sourceIsBasedOnUrl);
	return keys;
};

const loadHouseholdUnitPreferences = async (
	db: ReturnType<typeof getDb>,
	workosUserId: string,
	householdId: string | null
): Promise<UnitPreferences> => {
	if (!householdId) {
		return {
			preferredMassUnit: 'g',
			preferredVolumeUnit: 'ml',
			preferredTemperatureUnit: 'celsius',
			preferredTemperatureUnitLabel: '°C'
		};
	}
	const profileRows = await db
		.select({ locale: households.locale })
		.from(households)
		.where(eq(households.householdId, householdId))
		.limit(1);
	const unitPreferences = (
		await loadEffectiveTaxonomyPreferences(db, {
			workosUserId,
			householdId,
			locale: profileRows[0]?.locale ?? 'en-US'
		})
	).unitPreferences;
	return unitPreferences;
};

const normalizedUnitAliasKey = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[.,]+$/g, '');

const loadIngredientUnitAliases = async (
	db: ReturnType<typeof getDb>
): Promise<IngredientUnitAliases> => {
	const aliases = await db.select().from(unitAliases).where(isNull(unitAliases.sourceDomain));
	return Object.fromEntries(
		aliases.flatMap((alias) => {
			const canonicalUnit =
				canonicalIngredientUnit(alias.unitId) ?? canonicalIngredientUnit(alias.alias);
			return canonicalUnit ? [[normalizedUnitAliasKey(alias.alias), canonicalUnit]] : [];
		})
	);
};

const loadRecipeIdentities = async (db: ReturnType<typeof getDb>, workosUserId: string) =>
	db
		.select({
			id: userRecipes.id,
			title: userRecipes.title,
			sourceUrl: userRecipes.sourceUrl,
			sourceIsBasedOnUrl: userRecipes.sourceIsBasedOnUrl
		})
		.from(userRecipes)
		.where(and(eq(userRecipes.workosUserId, workosUserId), isNull(userRecipes.deletedAt)));

const loadSingleMenuRecipe = async (
	db: ReturnType<typeof getDb>,
	workosUserId: string,
	householdId: string | null,
	unitPreferences: UnitPreferences,
	recipeId: string
) =>
	(
		await loadMenuRecipes(db, workosUserId, householdId, {
			unitPreferences,
			recipeIds: [recipeId]
		})
	)[0];

const draftRecipeFromImport = (
	imported: Awaited<ReturnType<typeof fetchRecipeFromUrl>>,
	unitAliasMap: IngredientUnitAliases = {},
	unitPreferences: UnitPreferences = {}
): RecipeMenuItem => {
	const recipe = imported.recipe;
	const rawInstructions = instructionsFromRecipe(recipe);
	const ingredients = ingredientsFromRecipe(recipe, unitAliasMap);
	return {
		id: `draft-recipe-${crypto.randomUUID()}`,
		title: firstString(recipe.name, recipe.headline) ?? fallbackTitle,
		description: stringValue(recipe.description) ?? '',
		image: firstString(recipe.image),
		sourceUrl: imported.sourceUrl,
		sourceSiteName: imported.sourceSiteName,
		sourceAuthorName: imported.sourceAuthorName,
		sourcePublisherName: imported.sourcePublisherName,
		sourceIsBasedOnUrl: imported.sourceIsBasedOnUrl,
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
		instructions: rawInstructions.map((instruction) => {
			const text = convertInstructionTemperatures(instruction.text, unitPreferences);
			return { ...instruction, text };
		}),
		...emptyRecipeMenuStats()
	};
};

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	const importUrl = url.searchParams.get('importUrl')?.trim();
	if (importUrl) {
		const [unitAliasMap, unitPreferences] = await Promise.all([
			loadIngredientUnitAliases(db),
			loadHouseholdUnitPreferences(db, session.user.id, householdId)
		]);
		return json({
			recipe: draftRecipeFromImport(
				await fetchRecipeFromUrl(importUrl),
				unitAliasMap,
				unitPreferences
			)
		});
	}

	const { offset, limit } = boundedPagination(
		{
			offset: url.searchParams.get('offset'),
			limit: url.searchParams.get('limit')
		},
		defaultRecipePageSize,
		maxRecipePageSize
	);
	const query = url.searchParams.get('q') ?? '';
	const picker = url.searchParams.get('picker') === 'meal';
	const unitPreferences = await loadHouseholdUnitPreferences(db, session.user.id, householdId);
	const recipes = await loadMenuRecipes(db, session.user.id, householdId, {
		limit: query ? undefined : limit + (picker ? 0 : 1),
		offset: query || picker ? 0 : offset,
		unitPreferences
	});
	const rankedRecipes = rankRecipesByRelevance(recipes, query);
	if (picker) {
		return json({
			recipes: rankedRecipes.slice(0, limit),
			nextRecipeOffset: null
		});
	}
	const pageRecipes = query
		? rankedRecipes.slice(offset, offset + limit)
		: rankedRecipes.slice(0, limit);
	const nextRecipeOffset = query
		? rankedRecipes.length > offset + limit
			? offset + limit
			: null
		: recipes.length > limit
			? offset + limit
			: null;
	return json({
		recipes: pageRecipes,
		nextRecipeOffset
	});
};

const readBody = async (request: Request): Promise<CreateRecipeBody> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}
	if (!isRecord(body)) error(400, { message: 'Invalid request.' });
	return {
		title: stringValue(body.title),
		url: stringValue(body.url),
		recipe: recipeBody(body.recipe)
	};
};

const readBulkBody = async (request: Request): Promise<BulkRecipeBody> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}
	if (!isRecord(body) || !Array.isArray(body.recipeIds)) {
		error(400, { message: 'Choose at least one recipe.' });
	}
	const recipeIds = [
		...new Set(body.recipeIds.filter((id): id is string => typeof id === 'string'))
	];
	if (!recipeIds.length) error(400, { message: 'Choose at least one recipe.' });
	return { recipeIds, permanent: body.permanent === true };
};

const matchingExistingRecipe = (
	recipes: RecipeIdentity[],
	body: CreateRecipeBody,
	extraUrls: string[] = []
) => {
	const candidateUrlKeys = new Set<string>();
	addUrlKeys(candidateUrlKeys, body.url);
	addUrlKeys(candidateUrlKeys, body.recipe?.sourceUrl);
	addUrlKeys(candidateUrlKeys, body.recipe?.sourceIsBasedOnUrl);
	for (const url of extraUrls) addUrlKeys(candidateUrlKeys, url);

	if (candidateUrlKeys.size > 0) {
		const match = recipes.find((recipe) =>
			[...recipeUrlKeys(recipe)].some((key) => candidateUrlKeys.has(key))
		);
		if (match) return match;
	}

	const title = body.title ?? body.recipe?.title;
	if (!title) return;
	const normalizedTitle = title.trim().toLowerCase();
	return recipes.find((recipe) => recipe.title.trim().toLowerCase() === normalizedTitle);
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	const body = await readBody(request);
	if (body.url && body.url.length > maxUrlLength)
		error(400, { message: 'Recipe URL is too long.' });
	if (body.title && body.title.length > maxTitleLength)
		error(400, { message: 'Recipe name is too long.' });
	if (body.recipe?.title && body.recipe.title.length > maxTitleLength)
		error(400, { message: 'Recipe name is too long.' });
	if (!body.url && !body.title && !body.recipe) {
		error(400, { message: 'Enter a recipe name or URL.' });
	}

	const [unitPreferences, unitAliasMap, recipeIdentities] = await Promise.all([
		loadHouseholdUnitPreferences(db, session.user.id, householdId),
		loadIngredientUnitAliases(db),
		loadRecipeIdentities(db, session.user.id)
	]);
	const existingRecipe = matchingExistingRecipe(recipeIdentities, body);
	if (existingRecipe) {
		return json({
			recipe: await loadSingleMenuRecipe(
				db,
				session.user.id,
				householdId,
				unitPreferences,
				existingRecipe.id
			)
		});
	}

	const imported = body.url ? await fetchRecipeFromUrl(body.url) : undefined;
	const importedMatch = imported
		? matchingExistingRecipe(
				recipeIdentities,
				{ ...body, url: imported.sourceUrl },
				[
					firstString(imported.recipe.url),
					firstString(imported.recipe.mainEntityOfPage),
					imported.sourceIsBasedOnUrl
				].filter((value): value is string => Boolean(value))
			)
		: undefined;
	if (importedMatch) {
		return json({
			recipe: await loadSingleMenuRecipe(
				db,
				session.user.id,
				householdId,
				unitPreferences,
				importedMatch.id
			)
		});
	}

	const recipeJson =
		imported?.recipe ??
		(body.recipe ? schemaOrgFromRecipeItem(body.recipe) : minimalRecipe(body.title!));
	const recipeInstructions = body.recipe?.instructions ?? instructionsFromRecipe(recipeJson);
	const recipeId = crypto.randomUUID();

	await db.insert(userRecipes).values({
		id: recipeId,
		workosUserId: session.user.id,
		savedFromHouseholdId: householdId,
		title: firstString(recipeJson.name, recipeJson.headline) ?? body.recipe?.title ?? fallbackTitle,
		description: stringValue(recipeJson.description) ?? body.recipe?.description ?? null,
		imageUrl: firstString(recipeJson.image) ?? body.recipe?.image ?? null,
		prepTimeMinutes: body.recipe?.prepTimeMinutes ?? durationMinutes(recipeJson.prepTime) ?? null,
		cookTimeMinutes: body.recipe?.cookTimeMinutes ?? cookMinutesFromRecipe(recipeJson) ?? null,
		totalTimeMinutes:
			body.recipe?.totalTimeMinutes ?? durationMinutes(recipeJson.totalTime) ?? null,
		yield: body.recipe?.yield ?? firstNumber(recipeJson.recipeYield, recipeJson.yield) ?? null,
		sourceYieldText: firstString(recipeJson.recipeYield, recipeJson.yield) ?? null,
		sourceDatePublished: stringValue(recipeJson.datePublished) ?? null,
		sourceDateModified: stringValue(recipeJson.dateModified) ?? null,
		sourceLanguage: stringValue(recipeJson.inLanguage) ?? null,
		sourceUrl: imported?.sourceUrl ?? body.recipe?.sourceUrl ?? null,
		sourceSiteName: imported?.sourceSiteName ?? body.recipe?.sourceSiteName ?? null,
		sourceAuthorName: imported?.sourceAuthorName ?? body.recipe?.sourceAuthorName ?? null,
		sourcePublisherName: imported?.sourcePublisherName ?? body.recipe?.sourcePublisherName ?? null,
		sourceIsBasedOnUrl: imported?.sourceIsBasedOnUrl ?? body.recipe?.sourceIsBasedOnUrl ?? null,
		sourceRatingValue: ratingValue(recipeJson.aggregateRating, 'ratingValue') ?? null,
		sourceRatingCount: ratingValue(recipeJson.aggregateRating, 'ratingCount') ?? null,
		sourceReviewCount: ratingValue(recipeJson.aggregateRating, 'reviewCount') ?? null,
		sourceClaimedMinutes: body.recipe?.cookTimeMinutes ?? cookMinutesFromRecipe(recipeJson) ?? null,
		parseConfidence: imported ? 1 : 0.4,
		ingredientConfidence: imported ? 1 : body.recipe ? 1 : 0,
		instructionConfidence: imported ? 1 : body.recipe ? 1 : 0
	});

	await updateRecipeIngredients(
		db,
		recipeId,
		body.recipe?.ingredients ?? ingredientsFromRecipe(recipeJson, unitAliasMap)
	);
	await updateRecipeInstructions(db, recipeId, recipeInstructions);
	await saveRecipeSidecars(db, recipeId, recipeJson);

	const recipe = await loadSingleMenuRecipe(
		db,
		session.user.id,
		householdId,
		unitPreferences,
		recipeId
	);
	if (!recipe) error(500, { message: 'Recipe was created but could not be loaded.' });
	return json({ recipe }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	const { recipeIds } = await readBulkBody(request);
	const updatedAt = new Date().toISOString();
	await db
		.update(userRecipes)
		.set({ deletedAt: null, updatedAt })
		.where(
			and(
				eq(userRecipes.workosUserId, session.user.id),
				inArray(userRecipes.id, recipeIds),
				isNotNull(userRecipes.deletedAt)
			)
		);

	const unitPreferences = await loadHouseholdUnitPreferences(db, session.user.id, householdId);
	const recipes = await loadMenuRecipes(db, session.user.id, householdId, {
		unitPreferences,
		recipeIds
	});
	return json({ restored: true, recipeIds, recipes });
};

export const DELETE: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	const { recipeIds, permanent } = await readBulkBody(request);
	const existingRows = await db
		.select({ id: userRecipes.id })
		.from(userRecipes)
		.where(
			and(
				eq(userRecipes.workosUserId, session.user.id),
				inArray(userRecipes.id, recipeIds),
				permanent ? isNotNull(userRecipes.deletedAt) : isNull(userRecipes.deletedAt)
			)
		);
	const existingRecipeIds = existingRows.map((recipe) => recipe.id);
	if (!existingRecipeIds.length) {
		error(404, { message: permanent ? 'Archived recipes not found.' : 'Recipes not found.' });
	}

	if (permanent) {
		const mealLinks = await db
			.select({ householdMealId: householdMealUserRecipes.householdMealId })
			.from(householdMealUserRecipes)
			.where(inArray(householdMealUserRecipes.userRecipeId, existingRecipeIds));
		const householdMealIds = [...new Set(mealLinks.map((link) => link.householdMealId))];
		if (householdMealIds.length) {
			await db.delete(householdMeals).where(inArray(householdMeals.id, householdMealIds));
		}
		await db
			.delete(householdMealUserRecipes)
			.where(inArray(householdMealUserRecipes.userRecipeId, existingRecipeIds));
		await db
			.delete(userRecipes)
			.where(
				and(
					eq(userRecipes.workosUserId, session.user.id),
					inArray(userRecipes.id, existingRecipeIds),
					isNotNull(userRecipes.deletedAt)
				)
			);
		return json({
			deleted: true,
			permanent: true,
			recipeIds: existingRecipeIds,
			deletedMealCount: householdMealIds.length
		});
	}

	const deletedAt = new Date().toISOString();
	await db
		.update(userRecipes)
		.set({ deletedAt, updatedAt: deletedAt })
		.where(
			and(
				eq(userRecipes.workosUserId, session.user.id),
				inArray(userRecipes.id, existingRecipeIds),
				isNull(userRecipes.deletedAt)
			)
		);

	return json({ deleted: true, recipeIds: existingRecipeIds, deletedAt });
};
