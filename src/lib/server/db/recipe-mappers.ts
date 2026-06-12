import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '$lib/server/db/schema';
import {
	householdMealIngredients,
	householdMealInstructions,
	householdMeals,
	householdMealUserRecipes,
	mealCheckIns,
	userRecipeApplianceRequirements,
	userRecipeIngredients,
	userRecipeInstructions,
	userRecipes
} from '$lib/server/db/schema';
import type { MealFeedbackVerdict } from '$lib/components/dashboard/meal-labels';
import type { Meal } from '$lib/components/dashboard/schedule-types';
import type {
	RecipeIngredientItem,
	RecipeInstructionItem,
	RecipeMenuItem
} from '$lib/components/menu/menu-types';
import {
	canonicalIngredientUnit,
	parseIngredientAmount,
	type UnitPreferences
} from '$lib/recipes/ingredient-text';
import { displayIngredient, displayIngredientText } from '$lib/taxonomy/display';

type Db = DrizzleD1Database<typeof schema>;
type UserRecipeRow = typeof userRecipes.$inferSelect;
type UserRecipeIngredientRow = typeof userRecipeIngredients.$inferSelect;
type UserRecipeInstructionRow = typeof userRecipeInstructions.$inferSelect;
type UserRecipeApplianceRow = typeof userRecipeApplianceRequirements.$inferSelect;
type HouseholdMealRow = typeof householdMeals.$inferSelect;
type HouseholdMealIngredientRow = typeof householdMealIngredients.$inferSelect;
type HouseholdMealInstructionRow = typeof householdMealInstructions.$inferSelect;

type RecipeJson = Record<string, unknown>;

const fallbackTitle = 'Untitled recipe';
const maxIngredientRowsPerInsert = 8;
const maxInstructionRowsPerInsert = 16;

const duration = (minutes?: number): string | undefined =>
	minutes === undefined ? undefined : `PT${Math.max(0, Math.round(minutes))}M`;

const recipeTitle = (recipe: UserRecipeRow): string => recipe.title || fallbackTitle;

const recipeDescription = (recipe: UserRecipeRow): string => recipe.description ?? '';

const recipeImage = (recipe: UserRecipeRow): string | undefined => recipe.imageUrl ?? undefined;

const prepMinutes = (recipe: UserRecipeRow): number | undefined =>
	recipe.prepTimeMinutes ?? undefined;

const cookMinutes = (recipe: UserRecipeRow): number | undefined =>
	recipe.cookTimeMinutes ?? recipe.sourceClaimedMinutes ?? undefined;

const servings = (recipe: UserRecipeRow): number | undefined => recipe.yield ?? undefined;

const ingredientAmount = (
	ingredient: UserRecipeIngredientRow,
	unitPreferences: UnitPreferences = {}
): string => {
	const rendered = displayIngredient(ingredient, unitPreferences);
	if (rendered.amount) return rendered.amount;
	return rendered.item && ingredient.originalText.endsWith(rendered.item)
		? ingredient.originalText.slice(0, -rendered.item.length).trim()
		: '';
};

const ingredientItem = (
	ingredient: UserRecipeIngredientRow,
	unitPreferences: UnitPreferences = {}
): string => displayIngredient(ingredient, unitPreferences).item;

const ingredientAmountText = (ingredient: RecipeIngredientItem): string =>
	[ingredient.amount.trim(), ingredient.unit?.trim()].filter(Boolean).join(' ');

const fullIngredientText = (ingredient: RecipeIngredientItem): string =>
	[ingredientAmountText(ingredient), ingredient.item.trim()].filter(Boolean).join(' ');

const splitIngredientAmount = (
	amount: string,
	unitHint: string | null | undefined
): Pick<RecipeIngredientItem, 'amount' | 'unit'> => {
	const trimmed = amount.trim();
	const hintedUnit = canonicalIngredientUnit(unitHint ?? undefined) ?? unitHint?.trim();
	if (!trimmed) return hintedUnit ? { amount: '', unit: hintedUnit } : { amount: '' };
	const match = /^(.*?)(?:\s+([^\s]+(?:\s+[^\s]+)?))?$/.exec(trimmed);
	const candidateUnit = match?.[2]?.trim();
	const unit = canonicalIngredientUnit(candidateUnit) ?? hintedUnit;
	if (!unit || !candidateUnit) return { amount: trimmed, unit };
	return { amount: match?.[1]?.trim() ?? trimmed, unit };
};

const reviewSummary = (
	recipeId: string,
	checkInsByRecipeId: Map<string, (typeof mealCheckIns.$inferSelect)[]>
): RecipeMenuItem['reviewSummary'] => {
	const checkIns = checkInsByRecipeId.get(recipeId) ?? [];
	return {
		worthRepeating: checkIns.filter((checkIn) => checkIn.verdict === 'repeat').length,
		neutral: checkIns.filter((checkIn) => checkIn.verdict === 'neutral').length,
		neverAgain: checkIns.filter((checkIn) => checkIn.verdict === 'avoid').length,
		notes: checkIns.map((checkIn) => checkIn.reason).filter((note): note is string => Boolean(note))
	};
};

const recipeCookStats = (
	recipeId: string,
	mealsByRecipeId: Map<string, HouseholdMealRow[]>
): Pick<RecipeMenuItem, 'plannedCount' | 'timesCooked' | 'lastCookedAt'> => {
	const meals = mealsByRecipeId.get(recipeId) ?? [];
	const cookedMeals = meals.filter((meal) => meal.status === 'cooked');
	const lastCookedAt = cookedMeals
		.map((meal) => meal.date ?? meal.updatedAt)
		.toSorted()
		.at(-1);
	return { plannedCount: meals.length, timesCooked: cookedMeals.length, lastCookedAt };
};

const averageActualMinutes = (
	recipeId: string,
	checkInsByRecipeId: Map<string, (typeof mealCheckIns.$inferSelect)[]>
): number | undefined => {
	const minutes = (checkInsByRecipeId.get(recipeId) ?? [])
		.map((checkIn) => checkIn.cookTime)
		.filter((value): value is number => value !== null);
	if (!minutes.length) return;
	return minutes.reduce((sum, value) => sum + value, 0) / minutes.length;
};

const latestVerdict = (
	recipeId: string,
	checkInsByRecipeId: Map<string, (typeof mealCheckIns.$inferSelect)[]>
): MealFeedbackVerdict | undefined =>
	checkInsByRecipeId
		.get(recipeId)
		?.filter((checkIn) => checkIn.verdict)
		.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
		.at(-1)?.verdict;

const latestUserMealCheckIn = (
	mealId: string,
	workosUserId: string,
	checkInsByMealId: Map<string, (typeof mealCheckIns.$inferSelect)[]>
): Meal['latestCheckIn'] | undefined => {
	const checkIn = checkInsByMealId
		.get(mealId)
		?.filter((candidate) => candidate.workosUserId === workosUserId)
		.toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt))
		.at(-1);
	if (!checkIn) return;
	return {
		verdict: checkIn.verdict,
		cookTime: checkIn.cookTime ?? undefined,
		reason: checkIn.reason ?? undefined
	};
};

const groupByRecipeId = <T extends { userRecipeId: string }>(rows: T[]): Map<string, T[]> => {
	const grouped = new Map<string, T[]>();
	for (const row of rows) {
		grouped.set(row.userRecipeId, [...(grouped.get(row.userRecipeId) ?? []), row]);
	}
	return grouped;
};

export const schemaOrgFromRecipeItem = (recipe: RecipeMenuItem): RecipeJson => ({
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: recipe.title,
	description: recipe.description,
	image: recipe.image,
	url: recipe.sourceUrl,
	author: recipe.sourceAuthorName
		? { '@type': 'Person', name: recipe.sourceAuthorName }
		: undefined,
	publisher: recipe.sourcePublisherName
		? { '@type': 'Organization', name: recipe.sourcePublisherName }
		: undefined,
	isBasedOn: recipe.sourceIsBasedOnUrl,
	prepTime: duration(recipe.prepTimeMinutes),
	cookTime: duration(recipe.cookTimeMinutes),
	totalTime: duration(
		recipe.prepTimeMinutes !== undefined || recipe.cookTimeMinutes !== undefined
			? (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0)
			: undefined
	),
	recipeYield: recipe.yield,
	recipeIngredient: recipe.ingredients?.map(fullIngredientText),
	recipeInstructions: recipe.instructions?.map((instruction) => ({
		'@type': 'HowToStep',
		position: instruction.position,
		text: instruction.text
	}))
});

export const menuItemFromRecipe = (params: {
	recipe: UserRecipeRow;
	ingredients: UserRecipeIngredientRow[];
	instructions: UserRecipeInstructionRow[];
	appliances: UserRecipeApplianceRow[];
	plannedCount: number;
	timesCooked: number;
	lastCookedAt?: string;
	averageActualMinutes?: number;
	latestVerdict?: MealFeedbackVerdict;
	reviewSummary: RecipeMenuItem['reviewSummary'];
	unitPreferences?: UnitPreferences;
}): RecipeMenuItem => {
	const {
		recipe,
		ingredients,
		instructions,
		appliances,
		plannedCount,
		unitPreferences = {}
	} = params;
	return {
		id: recipe.id,
		title: recipeTitle(recipe),
		description: recipeDescription(recipe),
		image: recipeImage(recipe),
		sourceUrl: recipe.sourceUrl ?? undefined,
		sourceSiteName: recipe.sourceSiteName ?? undefined,
		sourceAuthorName: recipe.sourceAuthorName ?? undefined,
		sourcePublisherName: recipe.sourcePublisherName ?? undefined,
		sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl ?? undefined,
		sourceImportedAt: recipe.sourceImportedAt,
		sourceClaimedMinutes: recipe.sourceClaimedMinutes ?? undefined,
		archivedAt: recipe.deletedAt ?? undefined,
		averageActualMinutes: params.averageActualMinutes,
		parseConfidence: recipe.parseConfidence ?? undefined,
		ingredientConfidence: recipe.ingredientConfidence ?? undefined,
		instructionConfidence: recipe.instructionConfidence ?? undefined,
		nutritionConfidence: recipe.nutritionConfidence ?? undefined,
		userNotes: recipe.userNotes ?? undefined,
		prepTimeMinutes: prepMinutes(recipe),
		cookTimeMinutes: cookMinutes(recipe),
		totalTimeMinutes:
			prepMinutes(recipe) !== undefined || cookMinutes(recipe) !== undefined
				? (prepMinutes(recipe) ?? 0) + (cookMinutes(recipe) ?? 0)
				: undefined,
		yield: servings(recipe),
		ingredients: ingredients
			.toSorted((left, right) => left.lineIndex - right.lineIndex)
			.map((ingredient) => {
				const amount = splitIngredientAmount(
					ingredientAmount(ingredient, unitPreferences),
					ingredient.sourceUnitLabel
				);
				return {
					...amount,
					item: ingredientItem(ingredient, unitPreferences)
				};
			}),
		instructions: instructions
			.toSorted((left, right) => left.stepIndex - right.stepIndex)
			.map((instruction) => ({ position: instruction.stepIndex + 1, text: instruction.text })),
		ingredientCount: ingredients.length,
		appliances: appliances.map((appliance) => appliance.appliance),
		dietTags: [],
		timesCooked: params.timesCooked,
		plannedCount,
		lastCookedAt: params.lastCookedAt,
		latestVerdict: params.latestVerdict,
		reviewSummary: params.reviewSummary
	};
};

export const loadMenuRecipes = async (
	db: Db,
	workosUserId: string,
	householdId?: string | null,
	options: {
		limit?: number;
		offset?: number;
		unitPreferences?: UnitPreferences;
		recipeIds?: string[];
		archive?: 'active' | 'archived' | 'all';
	} = {}
) => {
	const archiveFilter =
		options.archive === 'archived'
			? isNotNull(userRecipes.deletedAt)
			: options.archive === 'all'
				? undefined
				: isNull(userRecipes.deletedAt);
	const recipeQuery = db
		.select()
		.from(userRecipes)
		.where(
			and(
				eq(userRecipes.workosUserId, workosUserId),
				archiveFilter,
				options.recipeIds?.length ? inArray(userRecipes.id, options.recipeIds) : undefined
			)
		)
		.orderBy(userRecipes.createdAt);
	const recipes = options.limit
		? await recipeQuery.limit(options.limit).offset(options.offset ?? 0)
		: await recipeQuery;

	if (!recipes.length) return [];
	const recipeIds = recipes.map((recipe) => recipe.id);
	const [ingredients, instructions, appliances, mealLinks] = await Promise.all([
		db
			.select()
			.from(userRecipeIngredients)
			.where(inArray(userRecipeIngredients.userRecipeId, recipeIds)),
		db
			.select()
			.from(userRecipeInstructions)
			.where(inArray(userRecipeInstructions.userRecipeId, recipeIds)),
		db
			.select()
			.from(userRecipeApplianceRequirements)
			.where(inArray(userRecipeApplianceRequirements.userRecipeId, recipeIds)),
		db
			.select()
			.from(householdMealUserRecipes)
			.where(inArray(householdMealUserRecipes.userRecipeId, recipeIds))
	]);
	const linkedMealIds = [...new Set(mealLinks.map((link) => link.householdMealId))];
	const householdMealRows = linkedMealIds.length
		? await db
				.select()
				.from(householdMeals)
				.where(
					and(
						inArray(householdMeals.id, linkedMealIds),
						householdId ? eq(householdMeals.householdId, householdId) : undefined
					)
				)
		: [];
	const visibleMealIds = new Set(householdMealRows.map((meal) => meal.id));
	const visibleMealLinks = mealLinks.filter((link) => visibleMealIds.has(link.householdMealId));
	const checkIns = visibleMealIds.size
		? await db
				.select()
				.from(mealCheckIns)
				.where(inArray(mealCheckIns.householdMealId, [...visibleMealIds]))
		: [];

	const ingredientsByRecipeId = groupByRecipeId(ingredients);
	const instructionsByRecipeId = groupByRecipeId(instructions);
	const appliancesByRecipeId = groupByRecipeId(appliances);
	const mealsById = new Map(householdMealRows.map((meal) => [meal.id, meal]));
	const checkInsByMealId = groupByMealId(checkIns);
	const mealsByRecipeId = new Map<string, HouseholdMealRow[]>();
	const checkInsByRecipeId = new Map<string, (typeof mealCheckIns.$inferSelect)[]>();
	for (const link of visibleMealLinks) {
		const meal = mealsById.get(link.householdMealId);
		if (meal) {
			mealsByRecipeId.set(link.userRecipeId, [
				...(mealsByRecipeId.get(link.userRecipeId) ?? []),
				meal
			]);
		}
		checkInsByRecipeId.set(link.userRecipeId, [
			...(checkInsByRecipeId.get(link.userRecipeId) ?? []),
			...(checkInsByMealId.get(link.householdMealId) ?? [])
		]);
	}

	return recipes.map((recipe) => {
		const cookStats = recipeCookStats(recipe.id, mealsByRecipeId);
		return menuItemFromRecipe({
			recipe,
			ingredients: ingredientsByRecipeId.get(recipe.id) ?? [],
			instructions: instructionsByRecipeId.get(recipe.id) ?? [],
			appliances: appliancesByRecipeId.get(recipe.id) ?? [],
			plannedCount: cookStats.plannedCount,
			timesCooked: cookStats.timesCooked,
			lastCookedAt: cookStats.lastCookedAt,
			averageActualMinutes: averageActualMinutes(recipe.id, checkInsByRecipeId),
			latestVerdict: latestVerdict(recipe.id, checkInsByRecipeId),
			reviewSummary: reviewSummary(recipe.id, checkInsByRecipeId),
			unitPreferences: options.unitPreferences ?? {}
		});
	});
};

export const mealFromMenuRecipe = (
	recipe: RecipeMenuItem,
	overrides: Partial<Meal> = {}
): Meal => ({
	id: recipe.id,
	title: recipe.title,
	cookTimeMinutes: recipe.cookTimeMinutes,
	servingsPlanned: recipe.yield ?? 1,
	baseServings: recipe.yield ?? 1,
	image: recipe.image,
	description: recipe.description,
	ingredients: recipe.ingredients?.map(fullIngredientText),
	instructions: recipe.instructions?.map((instruction) => instruction.text),
	...overrides
});

const mealIngredientText = (
	ingredient: HouseholdMealIngredientRow | UserRecipeIngredientRow,
	unitPreferences: UnitPreferences = {}
): string => displayIngredientText(ingredient, unitPreferences);

export const mealFromHouseholdMeal = (
	meal: HouseholdMealRow,
	ingredients: Array<HouseholdMealIngredientRow | UserRecipeIngredientRow> = [],
	instructions: Array<HouseholdMealInstructionRow | UserRecipeInstructionRow> = [],
	userRecipeId?: string,
	unitPreferences: UnitPreferences = {},
	latestVerdict?: Meal['latestVerdict'],
	latestCheckIn?: Meal['latestCheckIn']
): Meal => {
	const date = meal.date ?? undefined;
	return {
		id: meal.id,
		userRecipeId,
		title: meal.title || fallbackTitle,
		date,
		time: meal.time ?? undefined,
		sortOrder: meal.sortOrder ?? undefined,
		status: meal.status,
		plannedCookWorkosUserId: meal.plannedCookWorkosUserId ?? undefined,
		cookTimeMinutes: meal.cookTimeMinutes ?? undefined,
		servingsPlanned: meal.plannedYield ?? meal.yield ?? 1,
		baseServings: meal.yield ?? meal.plannedYield ?? 1,
		image: meal.imageUrl ?? undefined,
		description: meal.description ?? '',
		ingredients: ingredients
			.toSorted((left, right) => left.lineIndex - right.lineIndex)
			.map((ingredient) => mealIngredientText(ingredient, unitPreferences)),
		instructions: instructions
			.toSorted((left, right) => left.stepIndex - right.stepIndex)
			.map((instruction) => instruction.text),
		latestVerdict,
		latestCheckIn
	};
};

const groupByMealId = <T extends { householdMealId: string | null }>(
	rows: T[]
): Map<string, T[]> => {
	const grouped = new Map<string, T[]>();
	for (const row of rows) {
		if (!row.householdMealId) continue;
		grouped.set(row.householdMealId, [...(grouped.get(row.householdMealId) ?? []), row]);
	}
	return grouped;
};

export const loadMealPlanMeals = async (
	db: Db,
	params: {
		workosUserId: string;
		householdId: string;
		defaultMealServings?: number;
		startDate?: string;
		endDate?: string;
		menuRecipes?: RecipeMenuItem[];
		unitPreferences?: UnitPreferences;
		includeMealPool?: boolean;
	}
) => {
	const includeMealPool = params.includeMealPool ?? true;
	const unitPreferences = params.unitPreferences ?? {};

	const dateRangeFilter =
		params.startDate && params.endDate
			? includeMealPool
				? or(
						isNull(householdMeals.date),
						and(
							gte(householdMeals.date, params.startDate),
							lte(householdMeals.date, params.endDate)
						)
					)
				: and(gte(householdMeals.date, params.startDate), lte(householdMeals.date, params.endDate))
			: undefined;
	const householdMealRows = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.householdId, params.householdId), dateRangeFilter));
	const householdMealIds = householdMealRows.map((meal) => meal.id);
	const [mealIngredientRows, mealInstructionRows, mealLinks, checkIns] = householdMealIds.length
		? await Promise.all([
				db
					.select()
					.from(householdMealIngredients)
					.where(inArray(householdMealIngredients.householdMealId, householdMealIds)),
				db
					.select()
					.from(householdMealInstructions)
					.where(inArray(householdMealInstructions.householdMealId, householdMealIds)),
				db
					.select()
					.from(householdMealUserRecipes)
					.where(inArray(householdMealUserRecipes.householdMealId, householdMealIds)),
				db
					.select()
					.from(mealCheckIns)
					.where(inArray(mealCheckIns.householdMealId, householdMealIds))
			])
		: [[], [], [], []];
	const ingredientsByMealId = groupByMealId(mealIngredientRows);
	const instructionsByMealId = groupByMealId(mealInstructionRows);
	const recipeIdByMealId = new Map(
		mealLinks.map((link) => [link.householdMealId, link.userRecipeId])
	);
	const checkInsByMealId = groupByMealId(checkIns);
	const scheduledMeals = householdMealRows.map((meal) => {
		const latestCheckIn = latestUserMealCheckIn(meal.id, params.workosUserId, checkInsByMealId);
		return mealFromHouseholdMeal(
			meal,
			ingredientsByMealId.get(meal.id) ?? [],
			instructionsByMealId.get(meal.id) ?? [],
			recipeIdByMealId.get(meal.id),
			unitPreferences,
			latestCheckIn?.verdict,
			latestCheckIn
		);
	});

	return scheduledMeals;
};

export const updateRecipeIngredients = async (
	db: Db,
	recipeId: string,
	ingredients: RecipeIngredientItem[]
) => {
	await db.delete(userRecipeIngredients).where(eq(userRecipeIngredients.userRecipeId, recipeId));
	if (!ingredients.length) return;

	const rows = ingredients.map((ingredient, index) => {
		const amountText = ingredientAmountText(ingredient);
		const parsedAmount = parseIngredientAmount(amountText);
		return {
			userRecipeId: recipeId,
			lineIndex: index,
			originalText: fullIngredientText(ingredient),
			sourceAmountText: amountText || null,
			sourceQuantity: parsedAmount.quantity,
			sourceUnitLabel: parsedAmount.unit ?? (ingredient.unit?.trim() || null),
			sourceFoodLabel: ingredient.item.trim() || ingredient.amount.trim() || 'Ingredient',
			confidence: 1
		};
	});
	for (let index = 0; index < rows.length; index += maxIngredientRowsPerInsert) {
		await db
			.insert(userRecipeIngredients)
			.values(rows.slice(index, index + maxIngredientRowsPerInsert));
	}
};

export const updateRecipeInstructions = async (
	db: Db,
	recipeId: string,
	instructions: RecipeInstructionItem[]
) => {
	await db.delete(userRecipeInstructions).where(eq(userRecipeInstructions.userRecipeId, recipeId));
	if (!instructions.length) return;
	const rows = instructions.map((instruction, index) => ({
		userRecipeId: recipeId,
		stepIndex: index,
		text: instruction.text,
		confidence: 1
	}));
	for (let index = 0; index < rows.length; index += maxInstructionRowsPerInsert) {
		await db
			.insert(userRecipeInstructions)
			.values(rows.slice(index, index + maxInstructionRowsPerInsert));
	}
};
