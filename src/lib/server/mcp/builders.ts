import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	MealAggregateSchema,
	MealCheckInSchema,
	type MealAggregate,
	type MealCheckIn,
	type MealVerdict
} from '$lib/domain/meals/schema.js';
import {
	RecipeAggregateSchema,
	RecipeImportedCandidateSchema,
	type RecipeAggregate,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';
import { createRecipeAggregate, recipeSearchTokens } from '$lib/server/domain/remote-port.js';

import { toolError } from './results.js';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const text = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() ? value.trim() : null;

export const requiredText = (value: unknown, field: string): string => {
	const result = text(value);
	if (!result) throw toolError('invalid_input', `${field} is required.`);
	return result;
};

export const optionalNumber = (value: unknown, field: string): number | null | undefined => {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	throw toolError('invalid_input', `${field} must be a finite number.`);
};

const lines = (value: unknown, field: string): string[] | undefined => {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
		throw toolError('invalid_input', `${field} must contain only strings.`);
	}
	return value.map((item) => item.trim()).filter(Boolean);
};

export const candidateFromToolRecipe = (
	value: Record<string, unknown>,
	now = new Date().toISOString() as `${string}Z`
): RecipeImportedCandidate =>
	Schema.decodeUnknownSync(RecipeImportedCandidateSchema)({
		savedFromHouseholdId: null,
		title: requiredText(value.title, 'recipe.title'),
		description: text(value.description),
		imageUrl: text(value.imageUrl) ?? text(value.image),
		prepTimeMinutes: optionalNumber(value.prepTimeMinutes, 'prepTimeMinutes') ?? null,
		cookTimeMinutes: optionalNumber(value.cookTimeMinutes, 'cookTimeMinutes') ?? null,
		totalTimeMinutes: null,
		yield: optionalNumber(value.yield, 'yield') ?? null,
		sourceYieldText: null,
		sourceClaimedMinutes: null,
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: null,
		sourceUrl: text(value.sourceUrl),
		sourceSiteName: text(value.sourceSiteName),
		sourceAuthorName: text(value.sourceAuthorName),
		sourcePublisherName: text(value.sourcePublisherName),
		sourceIsBasedOnUrl: text(value.sourceIsBasedOnUrl),
		sourceImportedAt: now,
		sourceHtmlHash: null,
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		parseConfidence: null,
		ingredientConfidence: null,
		instructionConfidence: null,
		nutritionConfidence: null,
		userNotes: text(value.userNotes),
		ingredients: (lines(value.ingredients, 'ingredients') ?? []).map((line, lineIndex) => ({
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
			optional: false,
			confidence: 1,
			createdAt: now
		})),
		instructions: (lines(value.instructions, 'instructions') ?? []).map((line, stepIndex) => ({
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
		classifications: [],
		media: [],
		nutritionFacts: []
	});

const candidateFromAggregate = (recipe: RecipeAggregate): RecipeImportedCandidate => ({
	savedFromHouseholdId: recipe.savedFromHouseholdId,
	title: recipe.title,
	description: recipe.description,
	imageUrl: recipe.imageUrl,
	prepTimeMinutes: recipe.prepTimeMinutes,
	cookTimeMinutes: recipe.cookTimeMinutes,
	totalTimeMinutes: recipe.totalTimeMinutes,
	yield: recipe.yield,
	sourceYieldText: recipe.sourceYieldText,
	sourceClaimedMinutes: recipe.sourceClaimedMinutes,
	sourceDatePublished: recipe.sourceDatePublished,
	sourceDateModified: recipe.sourceDateModified,
	sourceLanguage: recipe.sourceLanguage,
	sourceUrl: recipe.sourceUrl,
	sourceSiteName: recipe.sourceSiteName,
	sourceAuthorName: recipe.sourceAuthorName,
	sourcePublisherName: recipe.sourcePublisherName,
	sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl,
	sourceImportedAt: recipe.sourceImportedAt,
	sourceHtmlHash: recipe.sourceHtmlHash,
	sourceRatingValue: recipe.sourceRatingValue,
	sourceRatingCount: recipe.sourceRatingCount,
	sourceReviewCount: recipe.sourceReviewCount,
	parseConfidence: recipe.parseConfidence,
	ingredientConfidence: recipe.ingredientConfidence,
	instructionConfidence: recipe.instructionConfidence,
	nutritionConfidence: recipe.nutritionConfidence,
	userNotes: recipe.userNotes,
	ingredients: recipe.ingredients,
	instructions: recipe.instructions,
	instructionEvents: recipe.instructionEvents,
	applianceRequirements: recipe.applianceRequirements,
	classifications: recipe.classifications,
	media: recipe.media,
	nutritionFacts: recipe.nutritionFacts
});

export const patchRecipe = (
	recipe: RecipeAggregate,
	patch: Record<string, unknown>,
	now = new Date().toISOString() as `${string}Z`
): RecipeAggregate => {
	const current = candidateFromAggregate(recipe);
	const replacementLines = candidateFromToolRecipe(
		{
			title: recipe.title,
			...(patch.ingredients !== undefined ? { ingredients: patch.ingredients } : {}),
			...(patch.instructions !== undefined ? { instructions: patch.instructions } : {})
		},
		now
	);
	const imagePatch = patch.imageUrl !== undefined ? patch.imageUrl : patch.image;
	const nextCandidate: RecipeImportedCandidate = {
		...current,
		...(patch.title !== undefined ? { title: requiredText(patch.title, 'title') } : {}),
		...(patch.description !== undefined ? { description: text(patch.description) } : {}),
		...(imagePatch !== undefined ? { imageUrl: text(imagePatch) } : {}),
		...(patch.prepTimeMinutes !== undefined
			? { prepTimeMinutes: optionalNumber(patch.prepTimeMinutes, 'prepTimeMinutes') ?? null }
			: {}),
		...(patch.cookTimeMinutes !== undefined
			? { cookTimeMinutes: optionalNumber(patch.cookTimeMinutes, 'cookTimeMinutes') ?? null }
			: {}),
		...(patch.yield !== undefined ? { yield: optionalNumber(patch.yield, 'yield') ?? null } : {}),
		...(patch.sourceUrl !== undefined ? { sourceUrl: text(patch.sourceUrl) } : {}),
		...(patch.sourceSiteName !== undefined ? { sourceSiteName: text(patch.sourceSiteName) } : {}),
		...(patch.sourceAuthorName !== undefined
			? { sourceAuthorName: text(patch.sourceAuthorName) }
			: {}),
		...(patch.sourcePublisherName !== undefined
			? { sourcePublisherName: text(patch.sourcePublisherName) }
			: {}),
		...(patch.sourceIsBasedOnUrl !== undefined
			? { sourceIsBasedOnUrl: text(patch.sourceIsBasedOnUrl) }
			: {}),
		...(patch.userNotes !== undefined ? { userNotes: text(patch.userNotes) } : {}),
		ingredients:
			patch.ingredients === undefined ? current.ingredients : replacementLines.ingredients,
		instructions:
			patch.instructions === undefined ? current.instructions : replacementLines.instructions,
		instructionEvents: patch.instructions === undefined ? current.instructionEvents : []
	};
	return Schema.decodeUnknownSync(RecipeAggregateSchema)({
		...recipe,
		...nextCandidate,
		updatedAt: now,
		searchTokens: recipeSearchTokens(nextCandidate)
	});
};

export const customMealFromArgs = (input: {
	householdId: string;
	actorUserId: string;
	custom: Record<string, unknown>;
	date?: string | null;
	time?: string | null;
	plannedCookUserId?: string | null;
	plannedYield?: number | null;
	now?: `${string}Z`;
}): MealAggregate => {
	const now = input.now ?? (new Date().toISOString() as `${string}Z`);
	const recipe = createRecipeAggregate({
		ownerUserId: input.actorUserId,
		candidate: candidateFromToolRecipe(
			{
				...input.custom,
				title: text(input.custom.title) ?? 'New meal'
			},
			now
		),
		now
	});
	const meal = {
		...recipe,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 0,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
		conflictClocks: {},
		id: uuidv7(),
		householdId: input.householdId,
		sourceRecipeId: null,
		date: input.date ?? null,
		time: input.time ?? null,
		sortOrder: null,
		plannedCookUserId: input.plannedCookUserId ?? null,
		plannedYield: input.plannedYield ?? null,
		status: 'planned' as const,
		notes: recipe.userNotes,
		ownerUserId: undefined,
		userNotes: undefined,
		searchTokens: undefined,
		savedFromHouseholdId: undefined
	};
	return Schema.decodeUnknownSync(MealAggregateSchema)(meal);
};

export const patchMeal = (
	meal: MealAggregate,
	patch: Record<string, unknown>,
	now = new Date().toISOString() as `${string}Z`
): MealAggregate => {
	const status = patch.status;
	return Schema.decodeUnknownSync(MealAggregateSchema)({
		...meal,
		...(patch.date !== undefined ? { date: patch.date } : {}),
		...(patch.time !== undefined ? { time: patch.time } : {}),
		...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
		...(patch.plannedCookUserId !== undefined
			? { plannedCookUserId: patch.plannedCookUserId }
			: {}),
		...(patch.servingsPlanned !== undefined
			? { plannedYield: optionalNumber(patch.servingsPlanned, 'servingsPlanned') }
			: {}),
		...(patch.plannedYield !== undefined
			? { plannedYield: optionalNumber(patch.plannedYield, 'plannedYield') }
			: {}),
		...(status === 'planned' || status === 'cooked' || status === 'skipped' ? { status } : {}),
		...(patch.title !== undefined ? { title: requiredText(patch.title, 'title') } : {}),
		...(patch.description !== undefined ? { description: text(patch.description) } : {}),
		...(patch.cookTimeMinutes !== undefined
			? { cookTimeMinutes: optionalNumber(patch.cookTimeMinutes, 'cookTimeMinutes') }
			: {}),
		updatedAt: now
	});
};

export const makeCheckIn = (input: {
	existing: MealCheckIn | null;
	mealId: string;
	reporterUserId: string;
	verdict: MealVerdict;
	cookTimeMinutes: number | null;
	reason: string | null;
	now?: `${string}Z`;
}): MealCheckIn => {
	const now = input.now ?? (new Date().toISOString() as `${string}Z`);
	return Schema.decodeUnknownSync(MealCheckInSchema)({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: input.existing?.revision ?? 0,
		createdAt: input.existing?.createdAt ?? now,
		updatedAt: now,
		deletedAt: null,
		conflictClocks: input.existing?.conflictClocks ?? {},
		id: input.existing?.id ?? uuidv7(),
		reporterUserId: input.reporterUserId,
		mealId: input.mealId,
		cookTimeMinutes: input.cookTimeMinutes,
		verdict: input.verdict,
		reason: input.reason
	});
};
