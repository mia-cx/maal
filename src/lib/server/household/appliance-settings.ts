import { applianceValues } from '$lib/domain/household/appliances';
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
}): Promise<number> => {
	const db = getDb(database);
	const now = new Date().toISOString();
	let changedCount = 0;

	for (const appliance of applianceValues) {
		if (!form.has(`available:${appliance}`) && !form.has(`notes:${appliance}`)) continue;
		changedCount += 1;
		const available = form.get(`available:${appliance}`) === 'on';
		const notes = String(form.get(`notes:${appliance}`) ?? '').trim() || null;
		await db
			.insert(householdAppliances)
			.values({ householdId, appliance, available, notes })
			.onConflictDoUpdate({
				target: [householdAppliances.householdId, householdAppliances.appliance],
				set: { available, notes, updatedAt: now }
			});
	}

	return changedCount;
};
