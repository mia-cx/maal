import type { MaalDatabase } from '$lib/client/local/database.js';

/** Stores a synced aggregate, or removes it when `aggregate` is undefined. */
export const storeSyncedAggregate = async (
	database: MaalDatabase,
	store: string,
	entityId: string,
	aggregate: unknown
): Promise<void> => {
	if (aggregate === undefined) await database.table(store).delete(entityId);
	else await database.table(store).put(aggregate);
};
