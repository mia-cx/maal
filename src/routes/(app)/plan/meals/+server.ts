import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { Meal, MealStatus } from '$lib/components/dashboard/schedule-types';
import { countActiveHouseholdMembers, listHouseholdMembers } from '$lib/server/auth/household';
import { requireAppContext } from '$lib/server/http/app-context';
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
import { loadEffectiveTaxonomyPreferences } from '$lib/server/taxonomy/effective-preferences';
import { copyRecipeSidecarsToMeal } from '$lib/server/services/meal-sidecars';
import { deleteHouseholdMeal, listHouseholdPlanMeals } from '$lib/server/services/meal-plan';
import { normalizeServingsPlanned } from '$lib/server/services/planned-servings';
import {
	replaceMealIngredientsFromLines,
	replaceMealInstructionsFromLines
} from '$lib/server/services/meal-sidecar-writer';

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
	yield: meal.baseServings ?? normalizeServingsPlanned(meal, defaultServings),
	plannedYield: normalizeServingsPlanned(meal, defaultServings),
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

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });
	const startDate = dateParam(url, 'start');
	const endDate = dateParam(url, 'end');
	if (!startDate || !endDate) error(400, { message: 'Date range is required.' });

	return json({
		meals: await listHouseholdPlanMeals({
			platform,
			db,
			workosUserId: session.user.id,
			householdId,
			startDate,
			endDate
		})
	});
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });
	const defaultMealServings = await countActiveHouseholdMembers(platform, householdId);

	const meal = await readMeal(request);
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
		plannedYield: normalizeServingsPlanned(meal, defaultMealServings),
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
		await replaceMealIngredientsFromLines(db, householdMealId, meal.ingredients);
		await replaceMealInstructionsFromLines(db, householdMealId, meal.instructions);
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
	const { db, householdId } = await requireAppContext({ cookies, locals, platform, url });

	const mealId = await readMealId(request);
	await deleteHouseholdMeal({ db, householdId, mealId });
	return json({ ok: true });
};

export const PUT: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });
	const defaultMealServings = await countActiveHouseholdMembers(platform, householdId);

	const meal = await readMeal(request);
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
			await replaceMealIngredientsFromLines(db, existingMeal.id, meal.ingredients);
		}
		if (meal.instructions !== undefined) {
			await replaceMealInstructionsFromLines(db, existingMeal.id, meal.instructions);
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
