import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { requireAppContext } from '$lib/server/http/app-context';
import { householdMeals, mealCheckIns } from '$lib/server/db/schema';
import type { MealFeedbackVerdict } from '$lib/components/dashboard/meal-labels';

const verdicts = new Set<MealFeedbackVerdict>(['repeat', 'neutral', 'avoid']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const readJson = async (request: Request): Promise<unknown> => {
	try {
		return await request.json();
	} catch {
		error(400, { message: 'Invalid request.' });
	}
};

const positiveInteger = (value: unknown): number | null => {
	if (value === undefined || value === null || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });

	const body = await readJson(request);
	const mealId = isRecord(body) && typeof body.mealId === 'string' ? body.mealId.trim() : '';
	const verdict = isRecord(body) && typeof body.verdict === 'string' ? body.verdict : '';
	if (!mealId) error(400, { message: 'Meal is required.' });
	if (!verdicts.has(verdict as MealFeedbackVerdict))
		error(400, { message: 'Verdict is required.' });

	const existingMeal = await db
		.select()
		.from(householdMeals)
		.where(and(eq(householdMeals.id, mealId), eq(householdMeals.householdId, householdId)))
		.get();
	if (!existingMeal) error(404, { message: 'Meal not found.' });

	const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason.trim() : '';
	const cooked = !isRecord(body) || body.cooked !== false;
	const canReportCookTime = existingMeal.plannedCookWorkosUserId === session.user.id;
	const cookTime =
		cooked && canReportCookTime
			? positiveInteger(isRecord(body) ? body.cookTime : undefined)
			: null;
	const updatedAt = new Date().toISOString();

	await db
		.insert(mealCheckIns)
		.values({
			workosUserId: session.user.id,
			householdMealId: mealId,
			verdict: verdict as MealFeedbackVerdict,
			cookTime,
			reason: reason || null,
			updatedAt
		})
		.onConflictDoUpdate({
			target: [mealCheckIns.householdMealId, mealCheckIns.workosUserId],
			set: {
				verdict: verdict as MealFeedbackVerdict,
				cookTime,
				reason: reason || null,
				updatedAt
			}
		});

	await db
		.update(householdMeals)
		.set({
			status: cooked ? 'cooked' : 'skipped',
			updatedAt
		})
		.where(eq(householdMeals.id, mealId));

	return json({ ok: true });
};
