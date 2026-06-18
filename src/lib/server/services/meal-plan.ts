import { and, eq } from 'drizzle-orm';
import type { Meal } from '$lib/plan/plan-types';
import { countActiveHouseholdMembers, listHouseholdMembers } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { householdMeals, householdMealUserRecipes, userRecipes } from '$lib/server/db/schema';
import { loadMealPlanMeals } from '$lib/server/db/recipe-mappers';
import { DomainError } from '$lib/server/domain-errors';
import { copyRecipeSidecarsToMeal } from '$lib/server/services/meal-sidecars';
import { loadHouseholdUnitPreferences } from '$lib/server/taxonomy/household-preferences';
import { normalizeServingsPlanned } from '$lib/server/services/planned-servings';
import {
	replaceMealIngredientsFromLines,
	replaceMealInstructionsFromLines
} from './meal-sidecar-writer';

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
		yield?: number;
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
		imageUrl: string | null;
		prepTimeMinutes: number | null;
		cookTimeMinutes: number | null;
		yield: number | null;
		ingredients: string[];
		instructions: string[];
	}>;
};

const loadUnitPreferences = (db: Db, workosUserId: string, householdId: string) =>
	loadHouseholdUnitPreferences(db, { workosUserId, householdId });

const ownedRecipe = async (db: Db, userRecipeId: string, workosUserId: string) =>
	db
		.select()
		.from(userRecipes)
		.where(and(eq(userRecipes.id, userRecipeId), eq(userRecipes.workosUserId, workosUserId)))
		.get();

const validateCook = async (
	platform: App.Platform | undefined,
	householdId: string,
	plannedCookWorkosUserId: string | null | undefined
) => {
	if (!plannedCookWorkosUserId) return;
	const householdMembers = await listHouseholdMembers(platform, householdId);
	if (!householdMembers.some((member) => member.userId === plannedCookWorkosUserId)) {
		throw new DomainError(
			'active_household_cook_required',
			'Choose an active household member as the cook.'
		);
	}
};

type HouseholdMealPatch = Partial<typeof householdMeals.$inferInsert>;

const mealUpdatePayload = (
	patch: UpdateHouseholdMealInput['patch'],
	existingMeal: typeof householdMeals.$inferSelect,
	plannedCookWorkosUserId: string | null | undefined,
	updatedAt: string
): HouseholdMealPatch => {
	const update: HouseholdMealPatch = { updatedAt };
	if (patch.date !== undefined) update.date = patch.date;
	if (patch.time !== undefined) update.time = patch.time;
	if (patch.sortOrder !== undefined) update.sortOrder = patch.sortOrder;
	if (patch.plannedCookUserId !== undefined)
		update.plannedCookWorkosUserId = plannedCookWorkosUserId;
	if (patch.servingsPlanned !== undefined) {
		update.plannedYield = normalizeServingsPlanned(
			{ servingsPlanned: patch.servingsPlanned },
			existingMeal.plannedYield ?? 1
		);
	}
	if (patch.status !== undefined) update.status = patch.status;
	if (patch.title !== undefined) update.title = patch.title;
	if (patch.imageUrl !== undefined) update.imageUrl = patch.imageUrl;
	if (patch.yield !== undefined) update.yield = patch.yield;
	if (patch.prepTimeMinutes !== undefined) update.prepTimeMinutes = patch.prepTimeMinutes;
	if (patch.description !== undefined) update.description = patch.description;
	if (patch.cookTimeMinutes !== undefined) update.cookTimeMinutes = patch.cookTimeMinutes;
	return update;
};

export const defaultMealServings = async (
	platform: App.Platform | undefined,
	householdId: string
) => Math.max(1, await countActiveHouseholdMembers(platform, householdId));

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
	const servingsDefault = await defaultMealServings(input.platform, meal.householdId);
	const plannedCookWorkosUserId = meal.plannedCookUserId ?? meal.workosUserId;
	await validateCook(input.platform, meal.householdId, plannedCookWorkosUserId);
	const recipe = meal.userRecipeId
		? await ownedRecipe(db, meal.userRecipeId, meal.workosUserId)
		: undefined;
	if (meal.userRecipeId && !recipe) throw new DomainError('recipe_not_found', 'Recipe not found.');

	const householdMealId = crypto.randomUUID();
	// Cloudflare D1 rejects Drizzle's interactive transaction `begin` path in local/dev
	// and worker runtimes. Keep meal creation D1-compatible by issuing ordered writes
	// directly: parent meal first, then link/sidecar rows that depend on it.
	await db.insert(householdMeals).values({
		id: householdMealId,
		householdId: meal.householdId,
		title: recipe?.title ?? meal.customMeal?.title?.trim() ?? 'New meal',
		description: recipe?.description ?? meal.customMeal?.description ?? null,
		imageUrl: recipe?.imageUrl ?? meal.customMeal?.imageUrl ?? null,
		prepTimeMinutes: recipe?.prepTimeMinutes ?? meal.customMeal?.prepTimeMinutes ?? null,
		cookTimeMinutes: recipe?.cookTimeMinutes ?? meal.customMeal?.cookTimeMinutes ?? null,
		yield: recipe?.yield ?? meal.customMeal?.yield ?? servingsDefault,
		plannedYield: normalizeServingsPlanned({ servingsPlanned: meal.servingsPlanned }, servingsDefault),
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
		await replaceMealIngredientsFromLines(db, householdMealId, meal.customMeal?.ingredients);
		await replaceMealInstructionsFromLines(db, householdMealId, meal.customMeal?.instructions);
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
		unitPreferences,
		mealId: input.mealId
	});
	const meal = rows.find((candidate) => candidate.id === input.mealId);
	if (!meal) throw new DomainError('meal_not_found', 'Meal not found.');
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
	if (!existingMeal) throw new DomainError('meal_not_found', 'Meal not found.');
	const plannedCookWorkosUserId =
		meal.patch.plannedCookUserId === undefined
			? existingMeal.plannedCookWorkosUserId
			: meal.patch.plannedCookUserId;
	await validateCook(input.platform, meal.householdId, plannedCookWorkosUserId);
	const updatedAt = new Date().toISOString();
	await db
		.update(householdMeals)
		.set(mealUpdatePayload(meal.patch, existingMeal, plannedCookWorkosUserId, updatedAt))
		.where(eq(householdMeals.id, existingMeal.id));
	if (meal.patch.ingredients !== undefined) {
		await replaceMealIngredientsFromLines(db, existingMeal.id, meal.patch.ingredients);
	}
	if (meal.patch.instructions !== undefined) {
		await replaceMealInstructionsFromLines(db, existingMeal.id, meal.patch.instructions);
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
