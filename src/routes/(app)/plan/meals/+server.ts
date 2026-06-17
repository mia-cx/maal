import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Meal } from '$lib/components/dashboard/schedule-types';
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

const dateParam = (url: URL, key: string): string | undefined => {
	const value = url.searchParams.get(key)?.trim();
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
};

const readMeal = async (request: Request): Promise<Meal> => {
	const body = await readJsonObject(request);
	if (!isRecord(body.meal)) error(400, { message: 'Meal is required.' });
	return body.meal as Meal;
};

const readMealId = async (request: Request): Promise<string> => {
	const body = await readJsonObject(request);
	const mealId = typeof body.mealId === 'string' ? body.mealId.trim() : '';
	if (!mealId) error(400, { message: 'Meal is required.' });
	return mealId;
};

export const GET: RequestHandler = async ({ cookies, locals, platform, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({ cookies, locals, platform, url });
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
	const { db, householdId, session } = await requireBillingAppContext({ cookies, locals, platform, url });
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
			recipe_not_found: { status: 404, message: 'Recipe not found.' },
			active_household_cook_required: {
				status: 400,
				message: 'Choose an active household member as the cook.'
			}
		});
	}
};

export const DELETE: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId } = await requireBillingAppContext({ cookies, locals, platform, url });

	const mealId = await readMealId(request);
	await deleteHouseholdMeal({ db, householdId, mealId });
	return json({ ok: true });
};

export const PUT: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireBillingAppContext({ cookies, locals, platform, url });
	const meal = await readMeal(request);

	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, meal.id), eq(householdMeals.householdId, householdId)))
		.get();

	if (!existingMeal) {
		if (!meal.date) return json({ meal });
		error(404, { message: 'Meal not found.' });
	}

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
				message: 'Choose an active household member as the cook.'
			},
			meal_not_found: { status: 404, message: 'Meal not found.' }
		});
	}
};
