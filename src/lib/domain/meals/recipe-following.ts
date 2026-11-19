import { Schema } from 'effect';

import type { LocalDate } from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	isRecipeAggregate,
	type RecipeAggregate,
	type StoredRecipe
} from '$lib/domain/recipes/schema.js';

import {
	MealAggregateSchema,
	RecipeFollowingMealSchema,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealAggregate,
	type RecipeFollowingMeal
} from './schema.js';

/** cyrb128: a fast, well-mixed 128-bit string hash. Deterministic on every runtime. */
const hash128 = (input: string): readonly [number, number, number, number] => {
	let h1 = 1779033703;
	let h2 = 3144134277;
	let h3 = 1013904242;
	let h4 = 2773480762;
	for (let index = 0; index < input.length; index += 1) {
		const code = input.charCodeAt(index);
		h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
		h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
		h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
		h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
	}
	h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
	h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
	h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
	h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
	h1 ^= h2 ^ h3 ^ h4;
	h2 ^= h1;
	h3 ^= h1;
	h4 ^= h1;
	return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
};

/**
 * The ID of a meal's row copied from one recipe row. It depends only on the two IDs, so every device
 * that copies or reads the same meal derives the same row IDs. Shaped as a UUIDv7 to fit `DomainId`.
 */
export const derivedMealRowId = (mealId: string, recipeRowId: string): string => {
	const hex = hash128(`${mealId}\u0000${recipeRowId}`)
		.map((part) => part.toString(16).padStart(8, '0'))
		.join('');
	const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** The fields a meal copy takes from `recipe`, with each row ID passed through `rowId`. */
const recipeContent = (recipe: RecipeAggregate, rowId: (recipeRowId: string) => string) => ({
	title: recipe.title,
	description: recipe.description,
	imageUrl: recipe.imageUrl,
	yield: recipe.yield,
	prepTimeMinutes: recipe.prepTimeMinutes,
	cookTimeMinutes: recipe.cookTimeMinutes,
	totalTimeMinutes: recipe.totalTimeMinutes,
	sourceYieldText: recipe.sourceYieldText,
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
	sourceClaimedMinutes: recipe.sourceClaimedMinutes,
	parseConfidence: recipe.parseConfidence,
	ingredientConfidence: recipe.ingredientConfidence,
	instructionConfidence: recipe.instructionConfidence,
	nutritionConfidence: recipe.nutritionConfidence,
	notes: recipe.userNotes,
	ingredients: recipe.ingredients.map((row) => ({ ...row, id: rowId(row.id) })),
	instructions: recipe.instructions.map((row) => ({ ...row, id: rowId(row.id) })),
	instructionEvents: recipe.instructionEvents.map(({ recipeInstructionId, ...row }) => ({
		...row,
		id: rowId(row.id),
		mealInstructionId: rowId(recipeInstructionId)
	})),
	applianceRequirements: recipe.applianceRequirements.map((row) => ({
		...row,
		id: rowId(row.id)
	})),
	classifications: recipe.classifications.map((row) => ({ ...row, id: rowId(row.id) })),
	media: recipe.media.map((row) => ({ ...row, id: rowId(row.id) })),
	nutritionFacts: recipe.nutritionFacts.map((row) => ({ ...row, id: rowId(row.id) }))
});

/**
 * The meal copy of `recipe` for `meal`. It keeps the meal's own fields and metadata and takes every
 * content field from the recipe, with row IDs from {@link derivedMealRowId}. Reading a
 * recipe-following meal and copying it give the same result.
 */
export const copyRecipeIntoMeal = (meal: LiveMeal, recipe: RecipeAggregate): MealAggregate =>
	Schema.decodeUnknownSync(MealAggregateSchema)({
		schemaVersion: meal.schemaVersion,
		revision: meal.revision,
		createdAt: meal.createdAt,
		updatedAt: meal.updatedAt,
		deletedAt: meal.deletedAt,
		conflictClocks: meal.conflictClocks,
		id: meal.id,
		householdId: meal.householdId,
		sourceRecipeId: recipe.id,
		date: meal.date,
		time: meal.time,
		sortOrder: meal.sortOrder,
		plannedCookUserId: meal.plannedCookUserId,
		plannedYield: meal.plannedYield,
		status: meal.status,
		...recipeContent(recipe, (recipeRowId) => derivedMealRowId(meal.id, recipeRowId))
	});

/**
 * What a recipe write does to the meals that follow the recipe (spec §5.3): `purge` when the
 * recipe's content goes away, `delete` when it moves to the bin, `edit` when anything a meal copy
 * holds changes, and null when the meals would show the same recipe. `before` and `after` must be
 * decoded, so their fields compare in schema order.
 */
export const recipeChangeKind = (
	before: RecipeAggregate,
	after: StoredRecipe | undefined
): 'edit' | 'delete' | 'purge' | null => {
	if (after === undefined || !isRecipeAggregate(after)) return 'purge';
	if (before.deletedAt === null && after.deletedAt !== null) return 'delete';
	const content = (recipe: RecipeAggregate) => JSON.stringify(recipeContent(recipe, String));
	return content(before) === content(after) ? null : 'edit';
};

/**
 * What a reader shows for a live meal: a meal copy as stored, and a recipe-following meal as its
 * recipe is now. A deleted recipe still has its content. Returns null while the recipe is missing or
 * purged on this device, so the meal stays out of views until the recipe or the meal's copy arrives.
 */
export const resolveMeal = (
	meal: LiveMeal,
	recipe: StoredRecipe | undefined
): MealAggregate | null => {
	if (!isRecipeFollowingMeal(meal)) return meal;
	if (recipe === undefined || !isRecipeAggregate(recipe)) return null;
	return copyRecipeIntoMeal(meal, recipe);
};

/** Where and for how many a recipe is planned. Omitted fields are null; servings follow the recipe. */
export interface PlanMealOptions {
	date?: string | null;
	time?: string | null;
	sortOrder?: number | null;
	plannedCookUserId?: string | null;
	plannedYield?: number | null;
}

/** A new recipe-following meal of `recipe`: planning stores only the meal's own fields (spec §5.3). */
export const planRecipeFollowingMeal = (input: {
	readonly recipe: RecipeAggregate;
	readonly householdId: string;
	readonly mealId: string;
	readonly occurredAt: string;
	readonly options?: PlanMealOptions;
}): RecipeFollowingMeal => {
	const options = input.options ?? {};
	return Schema.decodeUnknownSync(RecipeFollowingMealSchema)({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 0,
		createdAt: input.occurredAt,
		updatedAt: input.occurredAt,
		deletedAt: null,
		conflictClocks: {},
		id: input.mealId,
		householdId: input.householdId,
		sourceRecipeId: input.recipe.id,
		followsRecipe: true,
		date: options.date ?? null,
		time: options.time ?? null,
		sortOrder: options.sortOrder ?? null,
		plannedCookUserId: options.plannedCookUserId ?? null,
		plannedYield:
			options.plannedYield ??
			(input.recipe.yield === null ? null : Math.max(1, Math.round(input.recipe.yield))),
		status: 'planned'
	});
};

/** Today's date in a household's timezone, or in UTC when the household has none. */
export const householdToday = (now: Date, timeZone: string | null): LocalDate =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: timeZone ?? 'UTC',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now) as LocalDate;

/**
 * True when a recipe-following meal must take a copy before its recipe changes: it was cooked or
 * skipped, or its date has passed, so it must keep the version it was cooked with (spec §5.3 rule 4).
 */
export const freezesBeforeRecipeChange = (meal: RecipeFollowingMeal, today: LocalDate): boolean =>
	meal.status !== 'planned' || (meal.date !== null && meal.date < today);
