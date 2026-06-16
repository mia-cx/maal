import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAppContext } from '$lib/server/http/app-context';
import { mapKnownError } from '$lib/server/http/domain-errors';
import { readMealCheckInInput } from '$lib/server/services/meal-check-in-input';
import { upsertMealCheckIn } from '$lib/server/services/meal-check-ins';

export const POST: RequestHandler = async ({ cookies, locals, platform, request, url }) => {
	const { db, householdId, session } = await requireAppContext({ cookies, locals, platform, url });
	try {
		await upsertMealCheckIn(db, await readMealCheckInInput(request, householdId, session.user.id));
		return json({ ok: true });
	} catch (cause) {
		return mapKnownError(cause, { 'Meal not found.': 404 });
	}
};
