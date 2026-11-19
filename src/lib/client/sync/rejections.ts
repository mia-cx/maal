import Dexie from 'dexie';

import type { MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxRecord } from '$lib/client/local/records.js';
import { readActiveProfile } from '$lib/client/local/profiles.js';

/** One rejected write the person has not dismissed yet (spec §8.6). */
export interface RejectionNotice {
	readonly mutationId: string;
	readonly message: string;
}

const ENTITY_STORES: Readonly<Record<string, string>> = {
	recipe: 'recipes',
	meal: 'meals',
	meal_check_in: 'mealCheckIns',
	household: 'households'
};

const ENTITY_NOUNS: Readonly<Record<string, string>> = {
	recipe: 'a recipe',
	meal: 'a meal',
	meal_check_in: 'a check-in',
	household: 'household settings',
	householdAppliance: 'household appliances'
};

const titleOf = (value: unknown): string | null =>
	typeof value === 'object' &&
	value !== null &&
	'title' in value &&
	typeof value.title === 'string' &&
	value.title.length > 0
		? value.title
		: null;

const describeEntity = async (database: MaalDatabase, row: OutboxRecord): Promise<string> => {
	const store = ENTITY_STORES[row.entityKind];
	const local = store ? await database.table(store).get(row.aggregateId) : undefined;
	const title = titleOf(local) ?? titleOf(row.payload) ?? titleOf(row.snapshot);
	return title ? `“${title}”` : (ENTITY_NOUNS[row.entityKind] ?? 'a preference');
};

const messageFor = (code: string | undefined, name: string): string => {
	switch (code) {
		case 'tombstoned_entity':
			return `Your change to ${name} wasn’t saved because it was deleted.`;
		case 'historical_loser':
			return `A newer change to ${name} replaced yours.`;
		case 'planned_cook_not_member':
			return `Your change to ${name} wasn’t saved because the cook you chose left the household.`;
		case 'backfill_payload_too_large':
			return `Your copy of ${name} is too large to sync.`;
		default:
			return `Your change to ${name} wasn’t saved.`;
	}
};

/** The active profile's rejected writes that no notice has been dismissed for, oldest first. */
export const readUnseenRejections = async (database: MaalDatabase): Promise<RejectionNotice[]> => {
	const profile = await readActiveProfile(database);
	if (!profile) return [];
	const slot = await database.authSlots.where('profileId').equals(profile.profileId).first();
	if (!slot) return [];
	const rows = await database.outbox
		.where('[authSlotId+status+occurredAt]')
		.between(
			[slot.authSlotId, 'rejected', Dexie.minKey],
			[slot.authSlotId, 'rejected', Dexie.maxKey]
		)
		.filter((row) => row.rejectionSeenAt === undefined)
		.toArray();
	return Promise.all(
		rows.map(async (row) => ({
			mutationId: row.mutationId,
			message: messageFor(row.rejectionCode, await describeEntity(database, row))
		}))
	);
};

/** Dismisses the notice for these rejected writes in every open tab. */
export const markRejectionsSeen = async (
	database: MaalDatabase,
	mutationIds: readonly string[],
	now = new Date()
): Promise<void> => {
	const rejectionSeenAt = now.toISOString() as `${string}Z`;
	await database.transaction('rw', database.outbox, async () => {
		for (const mutationId of mutationIds) {
			await database.outbox.update(mutationId, { rejectionSeenAt });
		}
	});
};
