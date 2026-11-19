import { Schema } from 'effect';

import type { LocalDate } from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	isRecipeAggregate,
	type RecipeAggregate,
	type StoredRecipe
} from '$lib/domain/recipes/schema.js';
import {
	byEffect,
	isContentVersion,
	newestContentVersion,
	type ContentVersion,
	type RecipeVersion
} from '$lib/domain/recipes/versions.js';

import {
	MealAggregateSchema,
	RecipeFollowingMealSchema,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealAggregate,
	type MealCheckIn,
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

/** True when two recipes give a meal the same content. Both must be decoded, so fields compare in order. */
export const sameRecipeContent = (left: RecipeAggregate, right: RecipeAggregate): boolean =>
	JSON.stringify(recipeContent(left, String)) === JSON.stringify(recipeContent(right, String));

/**
 * The version a recipe write adds (spec §5.2): `content` when it creates the recipe or changes what a
 * meal shows, `deletion` when it takes a live recipe to the bin or purges it, and null otherwise,
 * such as a restore or a purge from the bin. Both sides must be decoded.
 */
export const versionChange = (
	before: StoredRecipe | undefined,
	after: StoredRecipe | undefined
): 'content' | 'deletion' | null => {
	const wasLive = before !== undefined && isRecipeAggregate(before) && before.deletedAt === null;
	if (after === undefined || !isRecipeAggregate(after) || after.deletedAt !== null) {
		return wasLive ? 'deletion' : null;
	}
	if (before === undefined || !isRecipeAggregate(before)) return 'content';
	return sameRecipeContent(before, after) ? null : 'content';
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date of `instant` in `timeZone`, or in UTC when it is null. */
export const localDateOf = (instant: string, timeZone: string | null): LocalDate => {
	const zone = timeZone ?? 'UTC';
	let formatter = dateFormatters.get(zone);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		dateFormatters.set(zone, formatter);
	}
	return formatter.format(new Date(instant)) as LocalDate;
};

/** What a recipe-following meal resolves against: its recipe's versions and its check-ins. */
export interface MealResolutionContext {
	readonly versions: readonly RecipeVersion[];
	readonly checkIns: readonly MealCheckIn[];
	/** The household's timezone; null resolves dates in UTC. */
	readonly timeZone: string | null;
}

const byCreation = (left: MealCheckIn, right: MealCheckIn): number =>
	left.createdAt === right.createdAt
		? left.id.localeCompare(right.id)
		: left.createdAt.localeCompare(right.createdAt);

/** The first deletion marker that took effect after the meal was planned, if any. */
const deletionCap = (meal: RecipeFollowingMeal, sorted: readonly RecipeVersion[]) =>
	sorted.find((version) => !isContentVersion(version) && version.effectiveAt > meal.createdAt);

/**
 * The version a recipe-following meal shows (spec §5.3), or null while it is not on this device.
 * The earliest live check-in pin decides; otherwise the newest content version in effect when the
 * meal's date ends, among those before the first deletion after the meal was planned, falling back
 * to the earliest of them. The result depends on synced data only, never on a device clock.
 */
export const resolveMealVersion = (
	meal: RecipeFollowingMeal,
	context: MealResolutionContext
): ContentVersion | null => {
	const sorted = context.versions
		.filter(({ recipeId }) => recipeId === meal.sourceRecipeId)
		.toSorted(byEffect);
	const pin = context.checkIns
		.filter(
			({ mealId, deletedAt, recipeVersionId }) =>
				mealId === meal.id && deletedAt === null && recipeVersionId !== null
		)
		.toSorted(byCreation)[0];
	if (pin !== undefined) {
		const pinned = sorted.find(({ id }) => id === pin.recipeVersionId);
		return pinned !== undefined && isContentVersion(pinned) ? pinned : null;
	}
	const cap = deletionCap(meal, sorted);
	const candidates = sorted
		.filter(isContentVersion)
		.filter((version) => cap === undefined || byEffect(version, cap) < 0);
	const date = meal.date;
	const inEffect =
		date === null
			? candidates
			: candidates.filter(({ effectiveAt }) => localDateOf(effectiveAt, context.timeZone) <= date);
	return inEffect.at(-1) ?? candidates[0] ?? null;
};

/**
 * What a reader shows for a live meal: a meal copy as stored, and a recipe-following meal as the
 * version it resolves to. Null while that version is not on this device, so the meal stays out of
 * views until it arrives.
 */
export const resolveMeal = (
	meal: LiveMeal,
	context: MealResolutionContext
): MealAggregate | null => {
	if (!isRecipeFollowingMeal(meal)) return meal;
	const version = resolveMealVersion(meal, context);
	return version === null ? null : copyRecipeIntoMeal(meal, version.recipe);
};

/** How long a superseded version stays at least, the window of ordinary change retention (§8.3). */
export const VERSION_RETENTION_MS = 90 * 86_400_000;

/**
 * The versions of one recipe that collection removes (spec §5.2). `meals` are the live
 * recipe-following meals of the recipe, and `checkIns` the live check-ins on live meals. A version
 * stays while it is the newest content version of a recipe that exists, while a meal resolves to it
 * or a check-in pins it, while it caps a meal's candidates, or until it and the version after it
 * took effect more than {@link VERSION_RETENTION_MS} before `now`.
 */
export const collectableVersions = (input: {
	readonly versions: readonly RecipeVersion[];
	readonly meals: readonly RecipeFollowingMeal[];
	readonly checkIns: readonly MealCheckIn[];
	readonly timeZones: ReadonlyMap<string, string | null>;
	readonly recipeExists: boolean;
	readonly now: Date;
}): RecipeVersion[] => {
	const sorted = input.versions.toSorted(byEffect);
	const needed = new Set<string>();
	for (const meal of input.meals) {
		const resolved = resolveMealVersion(meal, {
			versions: sorted,
			checkIns: input.checkIns,
			timeZone: input.timeZones.get(meal.householdId) ?? null
		});
		if (resolved !== null) needed.add(resolved.id);
		const cap = deletionCap(meal, sorted);
		if (cap !== undefined) needed.add(cap.id);
	}
	for (const { recipeVersionId } of input.checkIns) {
		if (recipeVersionId !== null) needed.add(recipeVersionId);
	}
	const newest = newestContentVersion(sorted);
	if (input.recipeExists && newest !== undefined) needed.add(newest.id);
	const horizon = input.now.getTime() - VERSION_RETENTION_MS;
	const settled = (version: RecipeVersion | undefined) =>
		version === undefined || Date.parse(version.effectiveAt) < horizon;
	return sorted.filter(
		(version, index) => !needed.has(version.id) && settled(version) && settled(sorted[index + 1])
	);
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
