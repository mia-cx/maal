import Dexie from 'dexie';

import type { MaalDatabase } from '$lib/client/local/database.js';

/** The pulled-change fields that say whether the server brought an entity back (spec §8.5). */
interface ReinstatingChange {
	readonly entityKind: string;
	readonly entityId: string;
	readonly reinstated?: true;
}

/**
 * Records a pulled change that brought back an entity this device holds as deleted or not at all,
 * so its card shows the Reinstated badge. Call before the change replaces the local record, inside
 * a transaction that includes `reinstatements` and the entity's store.
 */
export const noteReinstatement = async (
	database: MaalDatabase,
	store: string,
	change: ReinstatingChange,
	now: Date
): Promise<void> => {
	if (!change.reinstated) return;
	const local = (await database.table(store).get(change.entityId)) as
		{ deletedAt?: string | null } | undefined;
	if (local && local.deletedAt == null) return;
	await database.reinstatements.put({
		entityKind: change.entityKind,
		entityId: change.entityId,
		reinstatedAt: now.toISOString() as `${string}Z`
	});
};

/** IDs of the recipes or meals that show the Reinstated badge on this device. */
export const readReinstatedIds = async (
	database: MaalDatabase,
	entityKind: 'recipe' | 'meal'
): Promise<ReadonlySet<string>> => {
	const keys = await database.reinstatements
		.where('[entityKind+entityId]')
		.between([entityKind, Dexie.minKey], [entityKind, Dexie.maxKey])
		.primaryKeys();
	return new Set(keys.map(([, entityId]) => entityId));
};

/** Clears the Reinstated badge once the person opens the recipe or meal on this device. */
export const dismissReinstatement = (
	database: MaalDatabase,
	entityKind: 'recipe' | 'meal',
	entityId: string
): Promise<void> => database.reinstatements.delete([entityKind, entityId]);
