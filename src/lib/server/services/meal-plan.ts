import { and, eq } from 'drizzle-orm';
import type { Meal } from '$lib/components/dashboard/schedule-types';
import { countActiveHouseholdMembers, listHouseholdMembers } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import {
	householdMealIngredients,
	householdMealInstructions,
	householdMeals,
	householdMealUserRecipes,
	households,
	userRecipes
} from '$lib/server/db/schema';
import { loadMealPlanMeals, mealFromHouseholdMeal } from '$lib/server/db/recipe-mappers';
import { parseIngredientAmount, parseIngredientLine } from '$lib/recipes/ingredient-text';
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import { insertHouseholdMealInstructionEvents } from '$lib/server/taxonomy/instruction-events';
import { copyRecipeSidecarsToMeal } from '$lib/server/services/meal-sidecars';

type Db = ReturnType<typeof getDb>;

export type CreateHouseholdMealInput = {
	householdId: string;
	workosUserId: string;
	userRecipeId?: string;
	date?: string | null;
	time?: string | null;
	sortOrder?: number | null;
	plannedCookUserId?: string | null;
	servingsPlanned?: number | null;
	customMeal?: {
		title: string;
		description?: string;
		imageUrl?: string;
		prepTimeMinutes?: number;
		cookTimeMinutes?: number;
		ingredients?: string[];
		instructions?: string[];
	};
};

export type UpdateHouseholdMealInput = {
	householdId: string;
	workosUserId: string;
	mealId: string;
	patch: Partial<{
		date: string | null;
		time: string | null;
		sortOrder: number | null;
		plannedCookUserId: string | null;
		servingsPlanned: number;
		status: 'planned' | 'cooked' | 'skipped';
		title: string;
		description: string | null;
		prepTimeMinutes: number | null;
		cookTimeMinutes: number | null;
		ingredients: string[];
		instructions: string[];
	}>;
};

const servingsPlanned = (
	meal: { servingsPlanned?: number | null },
	defaultServings = 1
): number => {
	const servings = meal.servingsPlanned ?? defaultServings;
	return Number.isFinite(servings) ? Math.max(1, Math.round(servings)) : 1;
};

const loadUnitPreferences = async (db: Db, workosUserId: string, householdId: string) => {
	const profileRows = await db
		.select({ locale: households.locale })
		.from(households)
		.where(eq(households.householdId, householdId))
		.limit(1);
	return (
		await loadEffectiveTaxonomyPreferences(db, {
			workosUserId,
			householdId,
			locale: profileRows[0]?.locale ?? 'en-US'
		})
	).unitPreferences;
};

const ownedRecipe = async (db: Db, userRecipeId: string, workosUserId: string) =>
	db
		.select()
		.from(userRecipes)
		.where(and(eq(userRecipes.id, userRecipeId), eq(userRecipes.workosUserId, workosUserId)))
		.get();

const replaceMealIngredientsFromMeal = async (
	db: Db,
	householdMealId: string,
	ingredients: string[] = []
) => {
	await db
		.delete(householdMealIngredients)
		.where(eq(householdMealIngredients.householdMealId, householdMealId));
	for (const [index, line] of ingredients.entries()) {
		const parsed = parseIngredientLine(line);
		const amount = parseIngredientAmount(parsed.amount);
		await db.insert(householdMealIngredients).values({
			householdMealId,
			lineIndex: index,
			originalText: line,
			sourceAmountText: parsed.amount || null,
			sourceQuantity: amount.quantity,
			sourceUnitLabel: amount.unit,
			sourceFoodLabel: parsed.item || line,
			confidence: 1
		});
	}
};

const replaceMealInstructionsFromMeal = async (
	db: Db,
	householdMealId: string,
	instructions: string[] = []
) => {
	await db
		.delete(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	for (const [index, instruction] of instructions.entries()) {
		await db.insert(householdMealInstructions).values({
			householdMealId,
			stepIndex: index,
			text: instruction,
			confidence: 1
		});
	}
	const insertedInstructions = await db
		.select({ id: householdMealInstructions.id, text: householdMealInstructions.text })
		.from(householdMealInstructions)
		.where(eq(householdMealInstructions.householdMealId, householdMealId));
	await insertHouseholdMealInstructionEvents(db, insertedInstructions);
};

const validateCook = async (
	platform: App.Platform | undefined,
	householdId: string,
	plannedCookWorkosUserId: string | null | undefined
) => {
	if (!plannedCookWorkosUserId) return;
	const householdMembers = await listHouseholdMembers(platform, householdId);
	if (!householdMembers.some((member) => member.userId === plannedCookWorkosUserId)) {
		throw new Error('Choose an active household member as the cook.');
	}
};

export const listHouseholdPlanMeals = async (input: {
	platform: App.Platform | undefined;
	db: Db;
	workosUserId: string;
	householdId: string;
	startDate?: string;
	endDate?: string;
	includeFloating?: boolean;
}) => {
	const unitPreferences = await loadUnitPreferences(
		input.db,
		input.workosUserId,
		input.householdId
	);
	return loadMealPlanMeals(input.db, {
		workosUserId: input.workosUserId,
		householdId: input.householdId,
		defaultMealServings: await countActiveHouseholdMembers(input.platform, input.householdId),
		startDate: input.startDate,
		endDate: input.endDate,
		includeMealPool: input.includeFloating ?? true,
		unitPreferences
	});
};

export const createHouseholdMeal = async (input: {
	platform: App.Platform | undefined;
	db: Db;
	meal: CreateHouseholdMealInput;
}): Promise<Meal> => {
	const { db, meal } = input;
	const defaultMealServings = await countActiveHouseholdMembers(input.platform, meal.householdId);
	const plannedCookWorkosUserId = meal.plannedCookUserId ?? meal.workosUserId;
	await validateCook(input.platform, meal.householdId, plannedCookWorkosUserId);
	const unitPreferences = await loadUnitPreferences(db, meal.workosUserId, meal.householdId);
	const recipe = meal.userRecipeId
		? await ownedRecipe(db, meal.userRecipeId, meal.workosUserId)
		: undefined;
	if (meal.userRecipeId && !recipe) throw new Error('Recipe not found.');

	const householdMealId = crypto.randomUUID();
	await db.insert(householdMeals).values({
		id: householdMealId,
		householdId: meal.householdId,
		title: recipe?.title ?? meal.customMeal?.title?.trim() ?? 'New meal',
		description: recipe?.description ?? meal.customMeal?.description ?? null,
		imageUrl: recipe?.imageUrl ?? meal.customMeal?.imageUrl ?? null,
		prepTimeMinutes: recipe?.prepTimeMinutes ?? meal.customMeal?.prepTimeMinutes ?? null,
		cookTimeMinutes: recipe?.cookTimeMinutes ?? meal.customMeal?.cookTimeMinutes ?? null,
		yield: recipe?.yield ?? defaultMealServings,
		plannedYield: servingsPlanned({ servingsPlanned: meal.servingsPlanned }, defaultMealServings),
		plannedCookWorkosUserId,
		date: meal.date ?? null,
		time: meal.time ?? null,
		sortOrder: meal.sortOrder ?? null,
		status: 'planned'
	});

	if (recipe) {
		await db.insert(householdMealUserRecipes).values({ householdMealId, userRecipeId: recipe.id });
		await copyRecipeSidecarsToMeal(db, recipe.id, householdMealId);
	} else {
		await replaceMealIngredientsFromMeal(db, householdMealId, meal.customMeal?.ingredients);
		await replaceMealInstructionsFromMeal(db, householdMealId, meal.customMeal?.instructions);
	}

	return getHouseholdMeal({
		db,
		workosUserId: meal.workosUserId,
		householdId: meal.householdId,
		mealId: householdMealId
	});
};

export const getHouseholdMeal = async (input: {
	db: Db;
	workosUserId: string;
	householdId: string;
	mealId: string;
}): Promise<Meal> => {
	const unitPreferences = await loadUnitPreferences(
		input.db,
		input.workosUserId,
		input.householdId
	);
	const rows = await loadMealPlanMeals(input.db, {
		workosUserId: input.workosUserId,
		householdId: input.householdId,
		unitPreferences
	});
	const meal = rows.find((candidate) => candidate.id === input.mealId);
	if (!meal) throw new Error('Meal not found.');
	return meal;
};

export const updateHouseholdMeal = async (input: {
	platform: App.Platform | undefined;
	db: Db;
	meal: UpdateHouseholdMealInput;
}): Promise<Meal> => {
	const { db, meal } = input;
	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(
			and(eq(householdMeals.id, meal.mealId), eq(householdMeals.householdId, meal.householdId))
		)
		.get();
	if (!existingMeal) throw new Error('Meal not found.');
	const plannedCookWorkosUserId =
		meal.patch.plannedCookUserId === undefined
			? existingMeal.plannedCookWorkosUserId
			: meal.patch.plannedCookUserId;
	await validateCook(input.platform, meal.householdId, plannedCookWorkosUserId);
	const updatedAt = new Date().toISOString();
	await db
		.update(householdMeals)
		.set({
			date: meal.patch.date === undefined ? existingMeal.date : meal.patch.date,
			time: meal.patch.time === undefined ? existingMeal.time : meal.patch.time,
			sortOrder: meal.patch.sortOrder === undefined ? existingMeal.sortOrder : meal.patch.sortOrder,
			plannedCookWorkosUserId,
			plannedYield:
				meal.patch.servingsPlanned === undefined
					? existingMeal.plannedYield
					: servingsPlanned(
							{ servingsPlanned: meal.patch.servingsPlanned },
							existingMeal.plannedYield ?? 1
						),
			status: meal.patch.status ?? existingMeal.status,
			title: meal.patch.title ?? existingMeal.title,
			description:
				meal.patch.description === undefined ? existingMeal.description : meal.patch.description,
			cookTimeMinutes:
				meal.patch.cookTimeMinutes === undefined
					? existingMeal.cookTimeMinutes
					: meal.patch.cookTimeMinutes,
			updatedAt
		})
		.where(eq(householdMeals.id, existingMeal.id));
	if (meal.patch.ingredients !== undefined) {
		await replaceMealIngredientsFromMeal(db, existingMeal.id, meal.patch.ingredients);
	}
	if (meal.patch.instructions !== undefined) {
		await replaceMealInstructionsFromMeal(db, existingMeal.id, meal.patch.instructions);
	}
	return getHouseholdMeal({
		db,
		workosUserId: meal.workosUserId,
		householdId: meal.householdId,
		mealId: meal.mealId
	});
};

export const deleteHouseholdMeal = async (input: {
	db: Db;
	householdId: string;
	mealId: string;
}) => {
	const existingMeal = await input.db
		.select()
		.from(householdMeals)
		.where(
			and(eq(householdMeals.id, input.mealId), eq(householdMeals.householdId, input.householdId))
		)
		.get();
	if (!existingMeal) return false;
	await input.db.delete(householdMeals).where(eq(householdMeals.id, existingMeal.id));
	return true;
};
