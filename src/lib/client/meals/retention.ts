import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxStatus } from '$lib/client/local/records.js';
import { UtcInstantSchema, type UtcInstant } from '$lib/domain/contracts/primitives.js';
import {
	MealPurgeTombstoneSchema,
	StoredMealSchema,
	isMealAggregate,
	type MealAggregate,
	type MealPurgeTombstone
} from '$lib/domain/meals/schema.js';

const TOMBSTONE_RETENTION_MS = 365 * 86_400_000;
const UNRESOLVED_OUTBOX_STATUSES: readonly OutboxStatus[] = ['pending', 'sending', 'quarantined'];

/** Reduces a deleted meal to the minimal tombstone kept for one year once its content is removed. */
export const mealTombstone = (meal: MealAggregate, purgedAt: UtcInstant): MealPurgeTombstone => ({
	schemaVersion: meal.schemaVersion,
	revision: meal.revision,
	createdAt: meal.createdAt,
	updatedAt: meal.updatedAt,
	deletedAt: meal.deletedAt ?? purgedAt,
	conflictClocks: meal.conflictClocks,
	id: meal.id,
	householdId: meal.householdId,
	purgedAt,
	retainUntil: Schema.decodeUnknownSync(UtcInstantSchema)(
		new Date(Date.parse(purgedAt) + TOMBSTONE_RETENTION_MS).toISOString()
	)
});

/**
 * Local meal retention. Removes the content of deleted meals whose deletion the server acknowledged,
 * and drops tombstones past `retainUntil` once no outbox row still needs them for upload.
 * Unsynced households never reach this path for content: `deleteMeal` tombstones them at once.
 */
export const runMealRetention = async (
	database: MaalDatabase,
	now: UtcInstant = Schema.decodeUnknownSync(UtcInstantSchema)(new Date().toISOString()),
	batchSize = 25
): Promise<{ purgedMealIds: string[]; expiredTombstoneIds: string[]; hasMore: boolean }> => {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
		throw new TypeError('Meal retention batch size must be between 1 and 100.');
	}
	return database.transaction('rw', database.meals, database.outbox, async () => {
		// IndexedDB leaves null keys out of the index, so this reads deleted meals and tombstones only.
		const deleted = (await database.meals.where('deletedAt').above('').toArray()).map((record) =>
			Schema.decodeUnknownSync(StoredMealSchema)(record)
		);
		const outbox = await database.outbox
			.where('aggregateId')
			.anyOf(deleted.map(({ id }) => id))
			.filter(({ entityKind }) => entityKind === 'meal')
			.toArray();
		const acknowledgedDeletes = new Set(
			outbox
				.filter(({ operation, status }) => operation === 'delete' && status === 'acknowledged')
				.map(({ aggregateId }) => aggregateId)
		);
		const awaitingUpload = new Set(
			outbox
				.filter(({ status }) => UNRESOLVED_OUTBOX_STATUSES.includes(status))
				.map(({ aggregateId }) => aggregateId)
		);

		const purgeable = deleted.filter(
			(meal): meal is MealAggregate => isMealAggregate(meal) && acknowledgedDeletes.has(meal.id)
		);
		const purged = purgeable.slice(0, batchSize);
		if (purged.length > 0) {
			await database.meals.bulkPut(
				purged.map((meal) => Schema.encodeSync(MealPurgeTombstoneSchema)(mealTombstone(meal, now)))
			);
		}

		const expiredCandidates = deleted
			.filter(
				(record) =>
					!isMealAggregate(record) &&
					Date.parse(record.retainUntil) <= Date.parse(now) &&
					!awaitingUpload.has(record.id)
			)
			.map(({ id }) => id);
		const expiredTombstoneIds = expiredCandidates.slice(0, batchSize);
		if (expiredTombstoneIds.length > 0) await database.meals.bulkDelete(expiredTombstoneIds);

		return {
			purgedMealIds: purged.map(({ id }) => id),
			expiredTombstoneIds,
			hasMore:
				purgeable.length > purged.length || expiredCandidates.length > expiredTombstoneIds.length
		};
	});
};
