import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Meal } from '$lib/components/dashboard/schedule-types';
import { countActiveHouseholdMembers, resolveActiveHouseholdId } from '$lib/server/auth/household';
import { getDb } from '$lib/server/db';
import { householdMeals, userRecipes } from '$lib/server/db/schema';
import { loadMealPlanMeals, mealFromHouseholdMeal } from '$lib/server/db/recipe-mappers';

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

const scheduledFor = (meal: Meal): string | null => {
	if (!meal.date || !meal.time) return null;
	return `${meal.date}T${meal.time}:00`;
};

const servingsPlanned = (meal: Meal, defaultServings = 1): number => {
	const servings = meal.servingsPlanned ?? defaultServings;
	return Number.isFinite(servings) ? Math.max(1, Math.round(servings)) : 1;
};

const mealSnapshot = (meal: Meal, defaultServings = 1) => ({
	'@context': 'https://schema.org',
	'@type': 'Recipe',
	name: meal.title.trim() || 'New meal',
	description: meal.description ?? '',
	image: meal.image,
	cookTimeMinutes: meal.cookTimeMinutes,
	adjustedCookTimeMinutes: meal.adjustedCookTimeMinutes,
	recipeYield: servingsPlanned(meal, defaultServings),
	recipeIngredient: meal.ingredients ?? [],
	recipeInstructions: meal.instructions?.map((instruction, index) => ({
		'@type': 'HowToStep',
		position: index + 1,
		text: instruction
	}))
});

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

const plannedMealUpdate = (meal: Meal, defaultServings: number, recipeSnapshotJson?: unknown) => ({
	recipeSnapshotJson: recipeSnapshotJson ?? mealSnapshot(meal, defaultServings),
	date: meal.date ?? null,
	scheduledFor: scheduledFor(meal),
	sortOrder: meal.sortOrder ?? null,
	status: 'planned' as const,
	servingsPlanned: servingsPlanned(meal, defaultServings),
	updatedAt: new Date().toISOString()
});

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	const startDate = dateParam(url, 'start');
	const endDate = dateParam(url, 'end');
	if (!startDate || !endDate) error(400, { message: 'Date range is required.' });

	const db = getDb(platform.env.DB);
	return json({
		meals: await loadMealPlanMeals(db, {
			workosUserId: session.user.id,
			householdId,
			defaultMealServings: await countActiveHouseholdMembers(platform, householdId),
			startDate,
			endDate
		})
	});
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	const defaultMealServings = await countActiveHouseholdMembers(platform, householdId);

	const meal = await readMeal(request);
	const db = getDb(platform.env.DB);
	const userRecipeId = meal.userRecipeId;
	const recipe = userRecipeId ? await ownedRecipe(db, userRecipeId, session.user.id) : undefined;
	if (userRecipeId && !recipe) error(404, { message: 'Recipe not found.' });

	const householdMealId = crypto.randomUUID();
	await db.insert(householdMeals).values({
		id: householdMealId,
		householdId,
		userRecipeId: recipe?.id,
		recipeSnapshotJson: recipe?.schemaOrgRecipeJson ?? mealSnapshot(meal, defaultMealServings),
		date: meal.date ?? null,
		scheduledFor: scheduledFor(meal),
		sortOrder: meal.sortOrder ?? null,
		status: 'planned',
		servingsPlanned: servingsPlanned(meal, defaultMealServings)
	});

	const createdMeal = await db
		.select()
		.from(householdMeals)
		.where(eq(householdMeals.id, householdMealId))
		.get();
	return json({ meal: mealFromHouseholdMeal(createdMeal!, recipe) });
};

export const DELETE: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });

	const mealId = await readMealId(request);
	const db = getDb(platform.env.DB);
	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, mealId), eq(householdMeals.householdId, householdId)))
		.get();
	if (!existingMeal) error(404, { message: 'Meal not found.' });

	await db
		.update(householdMeals)
		.set({ status: 'archived', updatedAt: new Date().toISOString() })
		.where(eq(householdMeals.id, existingMeal.id));
	return json({ ok: true });
};

export const PUT: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const session = locals.session;
	if (!session) error(401, { message: 'Sign in required.' });
	if (!platform?.env.DB) error(503, { message: 'Database unavailable.' });
	const { householdId } = await resolveActiveHouseholdId({ platform, cookies, url, session });
	if (!householdId) error(400, { message: 'Household is required.' });
	const defaultMealServings = await countActiveHouseholdMembers(platform, householdId);

	const meal = await readMeal(request);
	const db = getDb(platform.env.DB);

	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, meal.id), eq(householdMeals.householdId, householdId)))
		.get();

	if (existingMeal) {
		await db
			.update(householdMeals)
			.set(
				plannedMealUpdate(
					meal,
					defaultMealServings,
					existingMeal.userRecipeId ? existingMeal.recipeSnapshotJson : undefined
				)
			)
			.where(eq(householdMeals.id, existingMeal.id));

		const [updatedMeal, recipe] = await Promise.all([
			db.select().from(householdMeals).where(eq(householdMeals.id, existingMeal.id)).get(),
			existingMeal.userRecipeId
				? ownedRecipe(db, existingMeal.userRecipeId, session.user.id)
				: undefined
		]);
		return json({ meal: mealFromHouseholdMeal(updatedMeal ?? existingMeal, recipe) });
	}

	if (!meal.date) return json({ meal });
	error(404, { message: 'Meal not found.' });
};
