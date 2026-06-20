import type { ClientHousehold } from './schema';
import { logClientDbDebug } from './debug';
import { getClientDb } from './db';
import { userScopedKey } from './schema';

type ClientSession = {
	user: {
		id: string;
		email: string;
		name: string | null;
		profilePictureUrl: string | null;
		emailVerified: boolean;
	};
};

export const writeAppContextCache = async ({
	session,
	households
}: {
	session: ClientSession | null;
	households: ClientHousehold[];
}): Promise<void> => {
	const db = getClientDb();
	const user = session?.user;
	if (!db || !user) return;
	const now = Date.now();
	logClientDbDebug('ui->dexie', 'write app context cache', {
		count: households.length,
		ids: households.map((household) => household.id),
		extra: { userId: user.id }
	});
	await db.transaction('rw', db.users, db.households, async () => {
		await db.users.put({
			id: user.id,
			email: user.email,
			name: user.name,
			profilePictureUrl: user.profilePictureUrl,
			emailVerified: user.emailVerified,
			updatedAt: now
		});
		await db.households.bulkPut(
			households.map((household) => ({
				...household,
				userId: user.id,
				key: userScopedKey(user.id, household.id),
				cachedAt: now
			}))
		);
	});
};

export const clearInactiveUserCache = async (
	activeUserId: string | null | undefined
): Promise<void> => {
	const db = getClientDb();
	if (!db) return;
	if (!activeUserId) {
		logClientDbDebug('ui->dexie', 'clear entire client db');
		await db.delete();
		return;
	}
	logClientDbDebug('ui->dexie', 'clear inactive user cache', { extra: { activeUserId } });
	await db.transaction('rw', db.tables, async () => {
		await db.users.where('id').notEqual(activeUserId).delete();
		await Promise.all([
			db.households.where('userId').notEqual(activeUserId).delete(),
			db.householdMembers.where('userId').notEqual(activeUserId).delete(),
			db.planRoutes.where('userId').notEqual(activeUserId).delete(),
			db.menuRoutes.where('userId').notEqual(activeUserId).delete(),
			db.recipes.where('userId').notEqual(activeUserId).delete(),
			db.plannedMeals.where('userId').notEqual(activeUserId).delete(),
			db.mealCheckIns.where('userId').notEqual(activeUserId).delete(),
			db.foodProfiles.where('userId').notEqual(activeUserId).delete(),
			db.billingEntitlements.where('userId').notEqual(activeUserId).delete(),
			db.uiStates.where('userId').notEqual(activeUserId).delete(),
			db.syncCursors.where('userId').notEqual(activeUserId).delete(),
			db.syncOutbox.where('userId').notEqual(activeUserId).delete()
		]);
	});
};
