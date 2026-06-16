import { applianceValues } from '$lib/domain/household/appliances';
import { optionalStringFromForm } from '$lib/domain/household/form-parsing';
import { getDb } from '$lib/server/db';
import { householdAppliances } from '$lib/server/db/schema';

export const updateHouseholdAppliancesFromForm = async ({
	database,
	householdId,
	form
}: {
	database: D1Database;
	householdId: string;
	form: FormData;
}): Promise<
	{ ok: true; changedCount: number } | { ok: false; status: number; message: string }
> => {
	const db = getDb(database);
	const now = new Date().toISOString();
	let changedCount = 0;

	for (const appliance of applianceValues) {
		if (!form.has(`available:${appliance}`) && !form.has(`notes:${appliance}`)) continue;
		changedCount += 1;
		const availableValue = form.get(`available:${appliance}`);
		if (availableValue !== null && availableValue !== 'on') {
			return { ok: false, status: 400, message: 'Invalid appliance availability value.' };
		}
		const available = availableValue === 'on';
		const notes = optionalStringFromForm(
			form.get(`notes:${appliance}`),
			'Appliance notes must be text.'
		);
		if (!notes.ok) return { ok: false, status: 400, message: notes.message };
		await db
			.insert(householdAppliances)
			.values({ householdId, appliance, available, notes: notes.value })
			.onConflictDoUpdate({
				target: [householdAppliances.householdId, householdAppliances.appliance],
				set: { available, notes: notes.value, updatedAt: now }
			});
	}

	return { ok: true, changedCount };
};
