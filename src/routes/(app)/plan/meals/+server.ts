import * as m from '$lib/paraglide/messages';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { isDateKey, parseDateKey } from '$lib/plan/date-key';
import type { Meal, MealStatus } from '$lib/plan/plan-types';
import { requireBillingAppContext } from '$lib/server/http/app-context';
import { mapKnownError } from '$lib/server/http/domain-errors';
import { readJsonObject } from '$lib/server/http/request';
import { householdMeals } from '$lib/server/db/schema';
import {
	createHouseholdMeal,
	defaultMealServings,
	deleteHouseholdMeal,
	listHouseholdPlanMeals,
	updateHouseholdMeal
} from '$lib/server/services/meal-plan';
import { mealToCreateInput, mealToUpdateInput } from '$lib/server/services/meal-route-input';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const mealStatuses = new Set<MealStatus>(['planned', 'cooked', 'skipped']);

const optionalString = (value: unknown, field: string): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string') return value;
	error(400, { message: `${field} must be a string.` });
};

const optionalNumber = (value: unknown, field: string): number | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	error(400, { message: `${field} must be a number.` });
};

const optionalStringArray = (value: unknown, field: string): string[] | undefined => {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	error(400, { message: `${field} must be a string array.` });
};

const optionalDateKey = (value: unknown, field: string): string | undefined => {
	const key = optionalString(value, field)?.trim();
	if (!key) return undefined;
	if (isDateKey(key)) return key;
	error(400, { message: `${field} must be a valid YYYY-MM-DD date.` });
};

const optionalMealStatus = (value: unknown): MealStatus | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') error(400, { message: 'meal.status must be a string.' });
	const status = value.trim();
	if (!mealStatuses.has(status as MealStatus))
		error(400, { message: m.plan_meal_status_is_invalid() });
	return status as MealStatus;
};

const dateParam = (url: URL, key: string): string | undefined => {
	const value = url.searchParams.get(key)?.trim();
	return value && isDateKey(value) ? value : undefined;
};

const readMeal = async (request: Request, options: { requireId?: boolean } = {}): Promise<Meal> => {
	const body = await readJsonObject(request);
	if (!isRecord(body.meal)) error(400, { message: m.plan_meal_is_required() });
	const meal = body.meal;
	const id = optionalString(meal.id, 'meal.id')?.trim();
	if (options.requireId && !id) error(400, { message: m.plan_meal_id_is_required() });
	const title = optionalString(meal.title, 'meal.title');
	if (typeof title !== 'string') error(400, { message: m.plan_meal_title_is_required() });
	const status = optionalMealStatus(meal.status);

	return {
		id: id ?? '',
		userRecipeId: optionalString(meal.userRecipeId, 'meal.userRecipeId'),
		title,
		day: optionalString(meal.day, 'meal.day'),
		date: optionalDateKey(meal.date, 'meal.date'),
		time: optionalString(meal.time, 'meal.time'),
		sortOrder: optionalNumber(meal.sortOrder, 'meal.sortOrder'),
		status,
		plannedCookWorkosUserId: optionalString(
			meal.plannedCookWorkosUserId,
			'meal.plannedCookWorkosUserId'
		),
		prepTimeMinutes: optionalNumber(meal.prepTimeMinutes, 'meal.prepTimeMinutes'),
		cookTimeMinutes: optionalNumber(meal.cookTimeMinutes, 'meal.cookTimeMinutes'),
		adjustedCookTimeMinutes: optionalNumber(
			meal.adjustedCookTimeMinutes,
			'meal.adjustedCookTimeMinutes'
		),
		servingsPlanned: optionalNumber(meal.servingsPlanned, 'meal.servingsPlanned'),
		baseServings: optionalNumber(meal.baseServings, 'meal.baseServings'),
		image: optionalString(meal.image, 'meal.image'),
		description: optionalString(meal.description, 'meal.description'),
		ingredients: optionalStringArray(meal.ingredients, 'meal.ingredients'),
		instructions: optionalStringArray(meal.instructions, 'meal.instructions')
	};
};

const readMealId = async (request: Request): Promise<string> => {
	const body = await readJsonObject(request);
	const mealId = typeof body.mealId === 'string' ? body.mealId.trim() : '';
	if (!mealId) error(400, { message: m.plan_meal_is_required() });
	return mealId;
};

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({
		cookies,
		locals,
		platform,
		url
	});
	const startDate = dateParam(url, 'start');
	const endDate = dateParam(url, 'end');
	if (!startDate || !endDate) error(400, { message: m.plan_valid_date_range_is_required() });
	if (parseDateKey(startDate)!.getTime() > parseDateKey(endDate)!.getTime()) {
		error(400, { message: m.plan_date_range_start_must_be_before_end() });
	}

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
	const { db, householdId, session } = await requireBillingAppContext({
		cookies,
		locals,
		platform,
		url
	});
	const meal = await readMeal(request);

	try {
		return json({
			meal: await createHouseholdMeal({
				platform,
				db,
				meal: mealToCreateInput(meal, householdId, session.user.id)
			})
		});
	} catch (cause) {
		return mapKnownError(cause, {
			recipe_not_found: { status: 404, message: m.plan_recipe_not_found() },
			active_household_cook_required: {
				status: 400,
				message: m.plan_choose_an_active_household_member_as_the_coo()
			}
		});
	}
};

export const DELETE: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId } = await requireBillingAppContext({ cookies, locals, platform, url });

	const mealId = await readMealId(request);
	const deleted = await deleteHouseholdMeal({ db, householdId, mealId });
	if (!deleted) error(404, { message: m.plan_meal_not_found() });
	return json({ ok: true });
};

export const PUT: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({
		cookies,
		locals,
		platform,
		url
	});
	const meal = await readMeal(request, { requireId: true });

	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, meal.id), eq(householdMeals.householdId, householdId)))
		.get();

	if (!existingMeal) error(404, { message: m.plan_meal_not_found() });

	try {
		return json({
			meal: await updateHouseholdMeal({
				platform,
				db,
				meal: mealToUpdateInput(
					meal,
					householdId,
					session.user.id,
					existingMeal,
					await defaultMealServings(platform, householdId)
				)
			})
		});
	} catch (cause) {
		return mapKnownError(cause, {
			active_household_cook_required: {
				status: 400,
				message: m.plan_choose_an_active_household_member_as_the_coo()
			},
			meal_not_found: { status: 404, message: m.plan_meal_not_found() }
		});
	}
};
