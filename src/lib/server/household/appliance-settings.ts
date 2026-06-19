import { applianceValues } from '$lib/domain/household/appliances';
import { optionalStringFromForm } from '$lib/domain/household/form-parsing';
import { getDb } from '$lib/server/db';
import { d1Batch } from '$lib/server/db/d1-batch';
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
	const parsedUpdates: Array<{
		appliance: (typeof applianceValues)[number];
		available: boolean;
		notes: string | null;
	}> = [];

	for (const appliance of applianceValues) {
		if (!form.has(`available:${appliance}`) && !form.has(`notes:${appliance}`)) continue;
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
		parsedUpdates.push({ appliance, available, notes: notes.value });
	}

	await d1Batch(
		database,
		parsedUpdates.map((row) =>
			db
				.insert(householdAppliances)
				.values({
					householdId,
					appliance: row.appliance,
					available: row.available,
					notes: row.notes
				})
				.onConflictDoUpdate({
					target: [householdAppliances.householdId, householdAppliances.appliance],
					set: { available: row.available, notes: row.notes, updatedAt: now }
				})
		)
	);

	return { ok: true, changedCount: parsedUpdates.length };
};
