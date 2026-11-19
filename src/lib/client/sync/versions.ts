import type { MaalDatabase } from '$lib/client/local/database.js';

/**
 * Stores a synced aggregate, or removes it when `aggregate` is undefined. A recipe version that
 * arrives with `deletedAt` set is one the Worker collected, so it is removed too (spec §5.2).
 */
export const storeSyncedAggregate = async (
	database: MaalDatabase,
	store: string,
	entityId: string,
	aggregate: unknown
): Promise<void> => {
	const collected =
		store === 'recipeVersions' &&
		(aggregate as { deletedAt?: unknown } | undefined)?.deletedAt != null;
	if (aggregate === undefined || collected) await database.table(store).delete(entityId);
	else await database.table(store).put(aggregate);
};
