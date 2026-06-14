import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { Meal, MealStatus } from '$lib/components/dashboard/schedule-types';
import {
	countActiveHouseholdMembers,
	listHouseholdMembers,
	resolveActiveHouseholdId
} from '$lib/server/auth/household';
import { requireHouseholdAccess } from '$lib/server/billing/guards';
import { getDb } from '$lib/server/db';
import {
	householdMealIngredients,
	householdMealInstructionEvents,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const dateParam = (url: URL, key: string): string | undefined => {
	const value = url.searchParams.get(key)?.trim();
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
};

const readJson = async (request: Request): Promise<unknown> => {
	try {
		return await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}
};

const readMeal = async (request: Request): Promise<Meal> => {
	const body = await readJson(request);
	if (!isRecord(body) || !isRecord(body.meal)) error(400, { message: 'Meal is required.' });
	return body.meal as Meal;
};

const readMealId = async (request: Request): Promise<string> => {
	const body = await readJson(request);
	const mealId = isRecord(body) && typeof body.mealId === 'string' ? body.mealId.trim() : '';
	if (!mealId) error(400, { message: 'Meal is required.' });
	return mealId;
};

const servingsPlanned = (meal: Meal, defaultServings = 1): number => {
	const servings = meal.servingsPlanned ?? defaultServings;
	return Number.isFinite(servings) ? Math.max(1, Math.round(servings)) : 1;
};

const loadUnitPreferences = async (
	db: ReturnType<typeof getDb>,
	workosUserId: string,
	householdId: string
) => {
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

const ownedRecipe = async (
	db: ReturnType<typeof getDb>,
	userRecipeId: string,
	workosUserId: string
) =>
	db
		.select()
		.from(userRecipes)
		.where(and(eq(userRecipes.id, userRecipeId), eq(userRecipes.workosUserId, workosUserId)))
		.get();

const plannedMealUpdate = (meal: Meal, defaultServings: number) => ({
	title: meal.title.trim() || 'New meal',
	description: meal.description ?? null,
	imageUrl: meal.image ?? null,
	prepTimeMinutes: meal.prepTimeMinutes ?? null,
	cookTimeMinutes: meal.cookTimeMinutes ?? null,
	yield: meal.baseServings ?? servingsPlanned(meal, defaultServings),
	plannedYield: servingsPlanned(meal, defaultServings),
	date: meal.date ?? null,
	time: meal.time ?? null,
	sortOrder: meal.sortOrder ?? null,
	status: meal.status ?? ('planned' satisfies MealStatus),
	plannedCookWorkosUserId: meal.plannedCookWorkosUserId ?? null,
	updatedAt: new Date().toISOString()
});

const loadInstructionEvents = async (
	db: ReturnType<typeof getDb>,
	instructions: Array<typeof householdMealInstructions.$inferSelect>
) => {
	const instructionIds = instructions.map((instruction) => instruction.id);
	if (!instructionIds.length) {
		return new Map<string, (typeof householdMealInstructionEvents.$inferSelect)[]>();
	}
	const rows = await db
		.select()
		.from(householdMealInstructionEvents)
		.where(inArray(householdMealInstructionEvents.householdMealInstructionId, instructionIds));
	const grouped = new Map<string, (typeof householdMealInstructionEvents.$inferSelect)[]>();
	for (const row of rows) {
		grouped.set(row.householdMealInstructionId, [
			...(grouped.get(row.householdMealInstructionId) ?? []),
			row
		]);
	}
	return grouped;
};

const replaceMealIngredientsFromMeal = async (
	db: ReturnType<typeof getDb>,
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
	db: ReturnType<typeof getDb>,
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

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	await requireHouseholdAccess({ platform, database: platform.env.DB, session, householdId });
	const startDate = dateParam(url, 'start');
	const endDate = dateParam(url, 'end');
	if (!startDate || !endDate) error(400, { message: 'Date range is required.' });

	const db = getDb(platform.env.DB);
	const unitPreferences = await loadUnitPreferences(db, session.user.id, householdId);
	return json({
		meals: await loadMealPlanMeals(db, {
			workosUserId: session.user.id,
			householdId,
			defaultMealServings: await countActiveHouseholdMembers(platform, householdId),
			startDate,
			endDate,
			unitPreferences
		})
	});
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	await requireHouseholdAccess({ platform, database: platform.env.DB, session, householdId });
	const defaultMealServings = await countActiveHouseholdMembers(platform, householdId);

	const meal = await readMeal(request);
	const db = getDb(platform.env.DB);
	const plannedCookWorkosUserId = meal.plannedCookWorkosUserId ?? session.user.id;
	const householdMembers = await listHouseholdMembers(platform, householdId);
	if (!householdMembers.some((member) => member.userId === plannedCookWorkosUserId)) {
		error(400, { message: 'Choose an active household member as the cook.' });
	}
	const unitPreferences = await loadUnitPreferences(db, session.user.id, householdId);
	const userRecipeId = meal.userRecipeId;
	const recipe = userRecipeId ? await ownedRecipe(db, userRecipeId, session.user.id) : undefined;
	if (userRecipeId && !recipe) error(404, { message: 'Recipe not found.' });

	const householdMealId = crypto.randomUUID();
	await db.insert(householdMeals).values({
		id: householdMealId,
		householdId,
		title: recipe?.title ?? meal.title.trim() ?? 'New meal',
		description: recipe?.description ?? meal.description ?? null,
		imageUrl: recipe?.imageUrl ?? meal.image ?? null,
		prepTimeMinutes: recipe?.prepTimeMinutes ?? meal.prepTimeMinutes ?? null,
		cookTimeMinutes: recipe?.cookTimeMinutes ?? meal.cookTimeMinutes ?? null,
		yield: recipe?.yield ?? meal.baseServings ?? defaultMealServings,
		plannedYield: servingsPlanned(meal, defaultMealServings),
		plannedCookWorkosUserId,
		date: meal.date ?? null,
		time: meal.time ?? null,
		sortOrder: meal.sortOrder ?? null,
		status: meal.status ?? 'planned'
	});

	if (recipe) {
		await db.insert(householdMealUserRecipes).values({
			householdMealId,
			userRecipeId: recipe.id
		});
	}

	if (recipe) {
		await copyRecipeSidecarsToMeal(db, recipe.id, householdMealId);
	} else {
		await replaceMealIngredientsFromMeal(db, householdMealId, meal.ingredients);
		await replaceMealInstructionsFromMeal(db, householdMealId, meal.instructions);
	}

	const [createdMeal, ingredients, instructions] = await Promise.all([
		db.select().from(householdMeals).where(eq(householdMeals.id, householdMealId)).get(),
		db
			.select()
			.from(householdMealIngredients)
			.where(eq(householdMealIngredients.householdMealId, householdMealId)),
		db
			.select()
			.from(householdMealInstructions)
			.where(eq(householdMealInstructions.householdMealId, householdMealId))
	]);
	const instructionEvents = await loadInstructionEvents(db, instructions);
	return json({
		meal: mealFromHouseholdMeal(
			createdMeal!,
			ingredients,
			instructions,
			instructionEvents,
			recipe?.id,
			unitPreferences
		)
	});
};

export const DELETE: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	await requireHouseholdAccess({ platform, database: platform.env.DB, session, householdId });

	const mealId = await readMealId(request);
	const db = getDb(platform.env.DB);
	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, mealId), eq(householdMeals.householdId, householdId)))
		.get();
	if (!existingMeal) return json({ ok: true });

	await db.delete(householdMeals).where(eq(householdMeals.id, existingMeal.id));
	return json({ ok: true });
};

export const PUT: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	await requireHouseholdAccess({ platform, database: platform.env.DB, session, householdId });
	const defaultMealServings = await countActiveHouseholdMembers(platform, householdId);

	const meal = await readMeal(request);
	const db = getDb(platform.env.DB);
	const unitPreferences = await loadUnitPreferences(db, session.user.id, householdId);

	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, meal.id), eq(householdMeals.householdId, householdId)))
		.get();

	if (existingMeal) {
		meal.plannedCookWorkosUserId ??= existingMeal.plannedCookWorkosUserId ?? undefined;
		meal.status ??= existingMeal.status;
		if (meal.plannedCookWorkosUserId) {
			const householdMembers = await listHouseholdMembers(platform, householdId);
			if (!householdMembers.some((member) => member.userId === meal.plannedCookWorkosUserId)) {
				error(400, { message: 'Choose an active household member as the cook.' });
			}
		}
		await db
			.update(householdMeals)
			.set(plannedMealUpdate(meal, defaultMealServings))
			.where(eq(householdMeals.id, existingMeal.id));
		if (meal.ingredients !== undefined) {
			await replaceMealIngredientsFromMeal(db, existingMeal.id, meal.ingredients);
		}
		if (meal.instructions !== undefined) {
			await replaceMealInstructionsFromMeal(db, existingMeal.id, meal.instructions);
		}

		const [updatedMeal, ingredients, instructions] = await Promise.all([
			db.select().from(householdMeals).where(eq(householdMeals.id, existingMeal.id)).get(),
			db
				.select()
				.from(householdMealIngredients)
				.where(eq(householdMealIngredients.householdMealId, existingMeal.id)),
			db
				.select()
				.from(householdMealInstructions)
				.where(eq(householdMealInstructions.householdMealId, existingMeal.id))
		]);
		const instructionEvents = await loadInstructionEvents(db, instructions);
		return json({
			meal: mealFromHouseholdMeal(
				updatedMeal ?? existingMeal,
				ingredients,
				instructions,
				instructionEvents,
				meal.userRecipeId,
				unitPreferences
			)
		});
	}

	if (!meal.date) return json({ meal });
	error(404, { message: 'Meal not found.' });
};
