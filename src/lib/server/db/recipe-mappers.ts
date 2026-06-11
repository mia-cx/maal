import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '$lib/server/db/schema';
import {
	householdMeals,
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
	displayIngredientAmount,
	parseIngredientAmount,
	type UnitPreferences
} from '$lib/recipes/ingredient-text';

type Db = DrizzleD1Database<typeof schema>;
type UserRecipeRow = typeof userRecipes.$inferSelect;
type UserRecipeIngredientRow = typeof userRecipeIngredients.$inferSelect;
type UserRecipeInstructionRow = typeof userRecipeInstructions.$inferSelect;
type UserRecipeApplianceRow = typeof userRecipeApplianceRequirements.$inferSelect;
type HouseholdMealRow = typeof householdMeals.$inferSelect;

type RecipeJson = Record<string, unknown>;

const fallbackTitle = 'Untitled recipe';

const stringValue = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;

const firstString = (...values: unknown[]): string | undefined => {
	for (const value of values) {
		if (Array.isArray(value)) {
			const nested = firstString(...value);
			if (nested) return nested;
			continue;
		}
		const text = stringValue(value);
		if (text) return text;
	}
};

const namedValue = (value: unknown): string | undefined => {
	if (typeof value === 'string') return stringValue(value);
	if (!value || typeof value !== 'object') return;
	const record = value as Record<string, unknown>;
	return firstString(record.name, record.url, record['@id']);
};

const imageValue = (value: unknown): string | undefined => {
	if (typeof value === 'string') return stringValue(value);
	if (Array.isArray(value)) return firstString(...value.map(imageValue));
	if (!value || typeof value !== 'object') return;
	const record = value as Record<string, unknown>;
	return firstString(record.url, record.contentUrl, record['@id']);
};

const parseDurationMinutes = (value: unknown): number | undefined => {
	const text = stringValue(value);
	if (!text) return;
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(text);
	if (!match) return;
	return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
};

const duration = (minutes?: number): string | undefined =>
	minutes === undefined ? undefined : `PT${Math.max(0, Math.round(minutes))}M`;

const firstNumber = (...values: unknown[]): number | undefined => {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			const match = /\d+(?:\.\d+)?/.exec(value);
			if (match) return Number(match[0]);
		}
	}
};

const recipeJson = (recipe: UserRecipeRow): RecipeJson =>
	(recipe.schemaOrgRecipeJson ?? {}) as RecipeJson;

const recipeTitle = (recipe: UserRecipeRow): string =>
	firstString(recipeJson(recipe).name, recipeJson(recipe).headline) ?? fallbackTitle;

const recipeDescription = (recipe: UserRecipeRow): string =>
	firstString(recipeJson(recipe).description) ?? '';

const recipeImage = (recipe: UserRecipeRow): string | undefined =>
	imageValue(recipeJson(recipe).image);

const prepMinutes = (recipe: UserRecipeRow): number | undefined =>
	parseDurationMinutes(recipeJson(recipe).prepTime);

const cookMinutes = (recipe: UserRecipeRow): number | undefined =>
	parseDurationMinutes(recipeJson(recipe).cookTime) ?? recipe.sourceClaimedMinutes ?? undefined;

const servings = (recipe: UserRecipeRow): number | undefined =>
	firstNumber(recipeJson(recipe).recipeYield, recipeJson(recipe).yield);

const ingredientAmount = (
	ingredient: UserRecipeIngredientRow,
	unitPreferences: UnitPreferences = {}
): string => {
	const item = ingredientItem(ingredient);
	const amount = displayIngredientAmount(
		ingredient.quantity,
		ingredient.unit,
		unitPreferences,
		item
	);
	if (amount) return amount;
	return item && ingredient.originalText.endsWith(item)
		? ingredient.originalText.slice(0, -item.length).trim()
		: '';
};

const ingredientItem = (ingredient: UserRecipeIngredientRow): string =>
	ingredient.parsedName ?? ingredient.originalText;

const fullIngredientText = (ingredient: RecipeIngredientItem): string =>
	[ingredient.amount.trim(), ingredient.item.trim()].filter(Boolean).join(' ');

const reviewSummary = (
	recipeId: string,
	checkInsByRecipeId: Map<string, (typeof mealCheckIns.$inferSelect)[]>
): RecipeMenuItem['reviewSummary'] => {
	const checkIns = checkInsByRecipeId.get(recipeId) ?? [];
	return {
		worthRepeating: checkIns.filter((checkIn) => checkIn.verdict === 'worth_repeating').length,
		neutral: checkIns.filter((checkIn) => checkIn.verdict === 'neutral').length,
		neverAgain: checkIns.filter((checkIn) => checkIn.verdict === 'never_again').length,
		notes: checkIns.map((checkIn) => checkIn.notes).filter((note): note is string => Boolean(note))
	};
};

const countByRecipeId = (rows: { userRecipeId: string | null; count: number }[]) =>
	new Map(rows.flatMap((row) => (row.userRecipeId ? [[row.userRecipeId, row.count]] : [])));

const groupByRecipeId = <T extends { userRecipeId: string | null }>(
	rows: T[]
): Map<string, T[]> => {
	const grouped = new Map<string, T[]>();
	for (const row of rows) {
		if (!row.userRecipeId) continue;
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
	recipeYield: recipe.servings,
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
	const json = recipeJson(recipe);
	return {
		id: recipe.id,
		title: recipeTitle(recipe),
		description: recipeDescription(recipe),
		image: recipeImage(recipe),
		sourceUrl: recipe.sourceUrl ?? firstString(json.url, json.mainEntityOfPage),
		sourceSiteName: recipe.sourceSiteName ?? undefined,
		sourceAuthorName: recipe.sourceAuthorName ?? namedValue(json.author),
		sourcePublisherName: recipe.sourcePublisherName ?? namedValue(json.publisher),
		sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl ?? firstString(json.isBasedOn),
		sourceImportedAt: recipe.sourceImportedAt,
		sourceClaimedMinutes: recipe.sourceClaimedMinutes ?? undefined,
		averageActualMinutes: recipe.averageActualMinutes ?? undefined,
		parseConfidence: recipe.parseConfidence ?? undefined,
		ingredientConfidence: recipe.ingredientConfidence ?? undefined,
		instructionConfidence: recipe.instructionConfidence ?? undefined,
		nutritionConfidence: recipe.nutritionConfidence ?? undefined,
		timeRealismConfidence: recipe.timeRealismConfidence ?? undefined,
		userNotes: recipe.userNotes ?? undefined,
		prepTimeMinutes: prepMinutes(recipe),
		cookTimeMinutes: cookMinutes(recipe),
		totalTimeMinutes:
			prepMinutes(recipe) !== undefined || cookMinutes(recipe) !== undefined
				? (prepMinutes(recipe) ?? 0) + (cookMinutes(recipe) ?? 0)
				: undefined,
		servings: servings(recipe),
		ingredients: ingredients
			.toSorted((left, right) => left.lineIndex - right.lineIndex)
			.map((ingredient) => ({
				amount: ingredientAmount(ingredient, unitPreferences),
				item: ingredientItem(ingredient)
			})),
		instructions: instructions
			.toSorted((left, right) => left.stepIndex - right.stepIndex)
			.map((instruction) => ({ position: instruction.stepIndex + 1, text: instruction.text })),
		ingredientCount: ingredients.length,
		appliances: appliances.map((appliance) => appliance.appliance),
		dietTags: [],
		timesCooked: recipe.timesCooked,
		plannedCount,
		lastCookedAt: recipe.lastCookedAt ?? undefined,
		latestVerdict: recipe.latestVerdict as MealFeedbackVerdict | undefined,
		reviewSummary: params.reviewSummary
	};
};

export const loadMenuRecipes = async (
	db: Db,
	workosUserId: string,
	householdId?: string | null,
	options: { limit?: number; offset?: number; unitPreferences?: UnitPreferences } = {}
) => {
	const recipeQuery = db
		.select()
		.from(userRecipes)
		.where(eq(userRecipes.workosUserId, workosUserId))
		.orderBy(userRecipes.createdAt);
	const recipes = options.limit
		? await recipeQuery.limit(options.limit).offset(options.offset ?? 0)
		: await recipeQuery;

	if (!recipes.length) return [];
	const recipeIds = recipes.map((recipe) => recipe.id);
	const [ingredients, instructions, appliances, checkIns, plannedCounts] = await Promise.all([
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
		db.select().from(mealCheckIns).where(inArray(mealCheckIns.userRecipeId, recipeIds)),
		db
			.select({ userRecipeId: householdMeals.userRecipeId, count: sql<number>`count(*)` })
			.from(householdMeals)
			.where(
				and(
					inArray(householdMeals.userRecipeId, recipeIds),
					householdId ? eq(householdMeals.householdId, householdId) : undefined,
					ne(householdMeals.status, 'archived')
				)
			)
			.groupBy(householdMeals.userRecipeId)
	]);

	const ingredientsByRecipeId = groupByRecipeId(ingredients);
	const instructionsByRecipeId = groupByRecipeId(instructions);
	const appliancesByRecipeId = groupByRecipeId(appliances);
	const checkInsByRecipeId = groupByRecipeId(checkIns);
	const plannedCountByRecipeId = countByRecipeId(plannedCounts);

	return recipes.map((recipe) =>
		menuItemFromRecipe({
			recipe,
			ingredients: ingredientsByRecipeId.get(recipe.id) ?? [],
			instructions: instructionsByRecipeId.get(recipe.id) ?? [],
			appliances: appliancesByRecipeId.get(recipe.id) ?? [],
			plannedCount: plannedCountByRecipeId.get(recipe.id) ?? 0,
			reviewSummary: reviewSummary(recipe.id, checkInsByRecipeId),
			unitPreferences: options.unitPreferences ?? {}
		})
	);
};

export const mealFromMenuRecipe = (
	recipe: RecipeMenuItem,
	overrides: Partial<Meal> = {}
): Meal => ({
	id: recipe.id,
	title: recipe.title,
	cookTimeMinutes: recipe.cookTimeMinutes,
	servingsPlanned: recipe.servings ?? 1,
	baseServings: recipe.servings ?? 1,
	image: recipe.image,
	description: recipe.description,
	ingredients: recipe.ingredients?.map(fullIngredientText),
	instructions: recipe.instructions?.map((instruction) => instruction.text),
	...overrides
});

const mealSnapshotFromRecipe = (recipe: UserRecipeRow): RecipeJson => {
	const json = recipeJson(recipe);
	return {
		name: recipeTitle(recipe),
		description: recipeDescription(recipe),
		image: recipeImage(recipe),
		cookTimeMinutes: cookMinutes(recipe),
		prepTimeMinutes: prepMinutes(recipe),
		recipeYield: servings(recipe),
		recipeIngredient: json.recipeIngredient,
		recipeInstructions: json.recipeInstructions
	};
};

export const mealFromHouseholdMeal = (meal: HouseholdMealRow, recipe?: UserRecipeRow): Meal => {
	const snapshot = (meal.recipeSnapshotJson ?? {}) as RecipeJson;
	const source = recipe ? mealSnapshotFromRecipe(recipe) : snapshot;
	const date = meal.date ?? meal.scheduledFor?.slice(0, 10) ?? undefined;
	return {
		id: meal.id,
		userRecipeId: meal.userRecipeId ?? undefined,
		title: firstString(source.name, source.title) ?? fallbackTitle,
		date,
		time: meal.scheduledFor?.slice(11, 16) ?? undefined,
		sortOrder: meal.sortOrder ?? undefined,
		cookTimeMinutes: firstNumber(source.cookTimeMinutes, source.sourceClaimedMinutes),
		servingsPlanned: meal.servingsPlanned,
		baseServings: firstNumber(source.recipeYield, source.yield) ?? meal.servingsPlanned,
		image: imageValue(source.image),
		description: firstString(source.description) ?? '',
		ingredients: Array.isArray(source.recipeIngredient)
			? source.recipeIngredient.map(String)
			: undefined,
		instructions: Array.isArray(source.recipeInstructions)
			? source.recipeInstructions.map((step) =>
					typeof step === 'string'
						? step
						: (firstString(
								(step as Record<string, unknown>).text,
								(step as Record<string, unknown>).name
							) ?? '')
				)
			: undefined
	};
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
	}
) => {
	const menuRecipes =
		params.menuRecipes ?? (await loadMenuRecipes(db, params.workosUserId, params.householdId));
	const defaultMealServings = Math.max(1, Math.round(params.defaultMealServings ?? 1));
	const poolMeals = menuRecipes
		.filter((recipe) => recipe.plannedCount === 0)
		.map((recipe, index) =>
			mealFromMenuRecipe(recipe, {
				userRecipeId: recipe.id,
				servingsPlanned: defaultMealServings,
				baseServings: recipe.servings ?? defaultMealServings,
				sortOrder: (index + 1) * 1000
			})
		);

	const dateRangeFilter =
		params.startDate && params.endDate
			? or(
					isNull(householdMeals.date),
					and(gte(householdMeals.date, params.startDate), lte(householdMeals.date, params.endDate))
				)
			: undefined;
	const householdMealRows = await db
		.select()
		.from(householdMeals)
		.where(
			and(
				eq(householdMeals.householdId, params.householdId),
				ne(householdMeals.status, 'archived'),
				dateRangeFilter
			)
		);
	const recipeIds = householdMealRows
		.map((meal) => meal.userRecipeId)
		.filter((id): id is string => Boolean(id));
	const recipeRows = recipeIds.length
		? await db.select().from(userRecipes).where(inArray(userRecipes.id, recipeIds))
		: [];
	const recipeById = new Map(recipeRows.map((recipe) => [recipe.id, recipe]));
	const scheduledMeals = householdMealRows.map((meal) =>
		mealFromHouseholdMeal(meal, meal.userRecipeId ? recipeById.get(meal.userRecipeId) : undefined)
	);

	return [...poolMeals, ...scheduledMeals];
};

export const updateRecipeIngredients = async (
	db: Db,
	recipeId: string,
	ingredients: RecipeIngredientItem[]
) => {
	await db.delete(userRecipeIngredients).where(eq(userRecipeIngredients.userRecipeId, recipeId));
	for (const [index, ingredient] of ingredients.entries()) {
		const parsedAmount = parseIngredientAmount(ingredient.amount);
		await db.insert(userRecipeIngredients).values({
			userRecipeId: recipeId,
			lineIndex: index,
			originalText: fullIngredientText(ingredient),
			parsedName: ingredient.item.trim() || null,
			quantity: parsedAmount.quantity,
			unit: parsedAmount.unit,
			confidence: 1
		});
	}
};

export const updateRecipeInstructions = async (
	db: Db,
	recipeId: string,
	instructions: RecipeInstructionItem[]
) => {
	await db.delete(userRecipeInstructions).where(eq(userRecipeInstructions.userRecipeId, recipeId));
	for (const [index, instruction] of instructions.entries()) {
		await db.insert(userRecipeInstructions).values({
			userRecipeId: recipeId,
			stepIndex: index,
			text: instruction.text,
			confidence: 1
		});
	}
};
