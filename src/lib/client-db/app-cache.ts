import type { PublicAuthSession } from '$lib/server/auth/session';
import type { ClientHousehold } from './schema';
import { getClientDb } from './db';
import { userScopedKey } from './schema';

export const writeAppContextCache = async ({
	session,
	households
}: {
	session: PublicAuthSession | null;
	households: ClientHousehold[];
}): Promise<void> => {
	const db = getClientDb();
	const user = session?.user;
	if (!db || !user) return;
	const now = Date.now();
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
		await db.delete();
		return;
	}
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
			db.syncCursors.where('userId').notEqual(activeUserId).delete(),
			db.syncOutbox.where('userId').notEqual(activeUserId).delete()
		]);
	});
};
