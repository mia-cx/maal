import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxRecord, SyncScopeRecord } from '$lib/client/local/records.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import type { UtcInstant } from '$lib/domain/contracts/primitives.js';
import { StoredRecipeSchema, type StoredRecipe } from '$lib/domain/recipes/schema.js';
import type { MutationReceipt } from '$lib/sync/contracts.js';
import {
	HOUSEHOLD_SHARED_RECIPE_KIND,
	MEAL_ALREADY_COPIED,
	type HouseholdBootstrapResponse,
	type HouseholdPullResponse,
	type HouseholdSnapshotManifestEntry,
	type HouseholdSyncChange,
	type HouseholdSyncEntityKind
} from '$lib/sync/household-contracts.js';
import {
	decodeHouseholdSyncAggregate,
	HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS,
	type DecodedHouseholdSyncAggregate
} from '$lib/sync/household-entities.js';

import { pruneAcknowledgedOutbox, recordServerChanges, scopeOutbox } from './outbox.js';
import { noteReinstatement } from './reinstatements.js';

/** The auth slot and household a coordinator applies server changes for. */
export interface HouseholdApplyScope {
	readonly authSlotId: string;
	readonly householdId: string;
}

const keyFor = (entityKind: string, entityId: string): string => `${entityKind}\u0000${entityId}`;

/**
 * Unacknowledged household intent from auth slots that still exist. Rows queued under a slot that is
 * gone (`signed-out:<profileId>`, waiting for that profile to sign in again) are not pushed by anyone
 * here, so they must not mask other profiles' pulls of the same household. Preserve their upload
 * snapshot before replacing the shared record. Needs `authSlots`, `outbox`, and the affected stores
 * in the surrounding transaction.
 */
const pendingHouseholdOutbox = async (
	database: MaalDatabase,
	householdId: string,
	replacements: readonly (Pick<
		DecodedHouseholdSyncAggregate,
		'entityKind' | 'entityId' | 'store'
	> & {
		aggregate?: unknown;
	})[]
): Promise<OutboxRecord[]> => {
	const rows = await scopeOutbox(database, 'household', householdId, [
		'pending',
		'sending',
		'quarantined'
	]);
	const slots = await database.authSlots.bulkGet([
		...new Set(rows.map(({ authSlotId }) => authSlotId))
	]);
	const live = new Set(slots.flatMap((slot) => (slot ? [slot.authSlotId] : [])));
	const deferred = Map.groupBy(
		rows.filter(({ authSlotId }) => !live.has(authSlotId)),
		(row) => keyFor(row.entityKind, row.aggregateId)
	);
	for (const replacement of replacements) {
		const affected = deferred.get(keyFor(replacement.entityKind, replacement.entityId)) ?? [];
		if (affected.length === 0) continue;
		const local = affected.some((row) => row.snapshot === undefined)
			? await database.table(replacement.store).get(replacement.entityId)
			: undefined;
		for (const row of affected) {
			const snapshot = row.snapshot ?? local;
			await database.outbox.update(row.mutationId, {
				snapshot,
				...(replacement.aggregate === undefined
					? {}
					: { authoritativeSnapshot: replacement.aggregate })
			});
			// A page may replace the same aggregate more than once; capture intent only once.
			row.snapshot = snapshot;
		}
	}
	return rows.filter(({ authSlotId }) => live.has(authSlotId));
};

type HouseholdEntityChange = HouseholdSyncChange & { readonly entityKind: HouseholdSyncEntityKind };

const isSharedRecipeChange = (change: HouseholdSyncChange): boolean =>
	change.entityKind === HOUSEHOLD_SHARED_RECIPE_KIND;

/**
 * Splits a page into the household's own changes, decoded, and the recipes shared with it. Shared
 * recipes are decoded too, so a malformed one fails the page like any other change.
 */
const decodeChanges = (
	householdId: string,
	changes: readonly HouseholdSyncChange[],
	requireSequenceOrder: boolean
) => {
	let prior = -1;
	const own: HouseholdEntityChange[] = [];
	const sharedRecipes: StoredRecipe[] = [];
	for (const change of changes) {
		if (requireSequenceOrder && change.sequence <= prior) {
			throw new TypeError('Sync changes must be strictly ordered.');
		}
		prior = change.sequence;
		if (isSharedRecipeChange(change)) sharedRecipes.push(decodeSharedRecipe(change));
		else own.push(change as HouseholdEntityChange);
	}
	return {
		own,
		decoded: own.map((change) =>
			decodeHouseholdSyncAggregate(
				change.entityKind,
				change.entityId,
				householdId,
				change.aggregate
			)
		),
		sharedRecipes
	};
};

const decodeSharedRecipe = (change: HouseholdSyncChange): StoredRecipe => {
	try {
		const recipe = Schema.decodeUnknownSync(StoredRecipeSchema)(change.aggregate);
		if (recipe.id !== change.entityId) throw new Error('entity mismatch');
		return recipe;
	} catch {
		throw new LocalDecodeError({
			operation: 'decode shared recipe',
			message: 'A recipe shared with the household did not match its contract.'
		});
	}
};

const UNSENT_STATUSES = new Set(['pending', 'sending', 'quarantined']);

/**
 * Stores the recipes shared with the household (spec §8.7). A recipe whose owner is signed in on
 * this device is skipped, because the owner's own recipe sync is authoritative; so is one whose
 * local copy is newer or has unsent edits. An owner who signed out or must reauthenticate syncs
 * nothing, so the household's copy applies. Needs `recipes`, `authSlots`, and `outbox` in the
 * surrounding transaction.
 */
const applySharedRecipes = async (
	database: MaalDatabase,
	recipes: readonly StoredRecipe[]
): Promise<void> => {
	for (const recipe of recipes) {
		const ownerSyncs = await database.authSlots
			.where('workosUserId')
			.equals(recipe.ownerUserId)
			.filter(({ sessionState }) => sessionState === 'authenticated')
			.count();
		if (ownerSyncs > 0) continue;
		const local = (await database.recipes.get(recipe.id)) as { revision?: number } | undefined;
		if (local !== undefined && (local.revision ?? 0) > recipe.revision) continue;
		const unsent = await database.outbox
			.where('aggregateId')
			.equals(recipe.id)
			.filter((row) => row.scopeKind === 'user' && UNSENT_STATUSES.has(row.status))
			.count();
		if (unsent > 0) continue;
		await database.table('recipes').put(recipe);
	}
};

const detachMealCheckIns = async (database: MaalDatabase, mealId: string): Promise<void> => {
	const checkIns = await database.mealCheckIns.where('mealId').equals(mealId).toArray();
	for (const checkIn of checkIns) await database.mealCheckIns.update(checkIn.id, { mealId: null });
};

export const applyHouseholdPullPage = async (
	database: MaalDatabase,
	scope: HouseholdApplyScope,
	response: HouseholdPullResponse,
	now = new Date()
): Promise<void> => {
	const { householdId } = scope;
	const { own, decoded, sharedRecipes } = decodeChanges(householdId, response.changes, true);
	if (response.changes.some(({ sequence }) => sequence > response.throughSequence)) {
		throw new TypeError('A sync page cannot advance behind one of its changes.');
	}
	const tables = [...new Set(decoded.map(({ store }) => database.table(store)))];
	await database.transaction(
		'rw',
		[
			...tables,
			database.recipes,
			database.mealCheckIns,
			database.outbox,
			database.authSlots,
			database.syncScopes,
			database.reinstatements
		],
		async () => {
			await applySharedRecipes(database, sharedRecipes);
			const pending = await pendingHouseholdOutbox(database, householdId, decoded);
			const pendingKeys = new Set(pending.map((row) => keyFor(row.entityKind, row.aggregateId)));
			const pendingByKey = Map.groupBy(pending, (row) => keyFor(row.entityKind, row.aggregateId));
			const localIntent = new Map<string, unknown>();
			for (const [index, aggregate] of decoded.entries()) {
				await noteReinstatement(database, aggregate.store, own[index]!, now);
				const key = keyFor(aggregate.entityKind, aggregate.entityId);
				if (pendingKeys.has(key)) {
					if (!localIntent.has(key)) {
						localIntent.set(key, await database.table(aggregate.store).get(aggregate.entityId));
					}
					for (const row of pendingByKey.get(key) ?? []) {
						await database.outbox.update(row.mutationId, {
							authoritativeSnapshot: aggregate.aggregate
						});
					}
				}
				await database.table(aggregate.store).put(aggregate.aggregate);
				if (
					aggregate.entityKind === 'meal' &&
					aggregate.aggregate.deletedAt !== null &&
					!pendingKeys.has(key)
				) {
					await detachMealCheckIns(database, aggregate.entityId);
				}
			}
			// Pending intent wins until acknowledged, including a hard delete that left no record.
			for (const aggregate of decoded) {
				const key = keyFor(aggregate.entityKind, aggregate.entityId);
				if (!localIntent.has(key)) continue;
				const local = localIntent.get(key);
				const table = database.table(aggregate.store);
				if (local === undefined) await table.delete(aggregate.entityId);
				else await table.put(local);
			}
			await recordServerChanges(
				database,
				{ authSlotId: scope.authSlotId, scopeKind: 'household', scopeId: householdId },
				own,
				now
			);
			const current = await database.syncScopes.get(['household', householdId]);
			if (
				current?.cursor !== null &&
				current?.cursor !== undefined &&
				response.throughSequence < current.cursor
			) {
				throw new TypeError('A stale sync page cannot move the local cursor backwards.');
			}
			const next: SyncScopeRecord = {
				scopeKind: 'household',
				scopeId: householdId,
				cursor: response.throughSequence,
				bootstrapGeneration: response.bootstrapGeneration,
				retainedFloor: response.retainedFloor,
				state: 'syncing',
				leaseOwner: current?.leaseOwner ?? null,
				leaseExpiresAt: current?.leaseExpiresAt ?? null,
				lastSuccessAt: now.toISOString() as `${string}Z`,
				lastErrorCode: null
			};
			await database.syncScopes.put(next);
		}
	);
};

export const applyHouseholdMutationReceipts = async (
	database: MaalDatabase,
	householdId: string,
	receipts: readonly MutationReceipt[],
	now = new Date()
): Promise<void> => {
	const resolved = await Promise.all(
		receipts.map(async (receipt) => {
			const stored = await database.outbox.get(receipt.mutationId);
			const row =
				stored?.scopeKind === 'household' && stored.scopeId === householdId ? stored : undefined;
			const authoritative =
				row && receipt.status === 'rejected' && row.authoritativeSnapshot !== undefined
					? decodeHouseholdSyncAggregate(
							row.entityKind as HouseholdSyncEntityKind,
							row.aggregateId,
							householdId,
							row.authoritativeSnapshot
						)
					: null;
			return { receipt, row, authoritative };
		})
	);
	const tables = resolved.flatMap(({ authoritative }) =>
		authoritative ? [database.table(authoritative.store)] : []
	);
	await database.transaction(
		'rw',
		[...new Set(tables), database.mealCheckIns, database.outbox, database.authSlots],
		async () => {
			const restorations = new Map<
				string,
				NonNullable<(typeof resolved)[number]['authoritative']>
			>();
			const acknowledged: OutboxRecord[] = [];
			for (const { receipt, row, authoritative } of resolved) {
				if (!row) continue;
				if (receipt.status === 'accepted' || receipt.status === 'duplicate') {
					await database.outbox.update(receipt.mutationId, {
						status: 'acknowledged',
						acknowledgedSequence: receipt.sequence,
						acknowledgedAt: now.toISOString()
					});
					acknowledged.push(row);
					continue;
				}
				if (!('errorCode' in receipt)) continue;
				await database.outbox.update(receipt.mutationId, {
					status: 'rejected',
					rejectionCode: receipt.errorCode,
					acknowledgedAt: now.toISOString(),
					// Another device copied the meal first; nothing the person did was lost (spec §8.6).
					...(receipt.errorCode === MEAL_ALREADY_COPIED
						? { rejectionSeenAt: now.toISOString() as UtcInstant }
						: {})
				});
				if (authoritative)
					restorations.set(keyFor(authoritative.entityKind, authoritative.entityId), authoritative);
			}
			await pruneAcknowledgedOutbox(database, acknowledged);
			const unresolvedKeys = new Set(
				(await pendingHouseholdOutbox(database, householdId, [...restorations.values()])).map(
					(row) => keyFor(row.entityKind, row.aggregateId)
				)
			);
			for (const [key, authoritative] of restorations) {
				if (unresolvedKeys.has(key)) continue;
				await database.table(authoritative.store).put(authoritative.aggregate);
				if (authoritative.entityKind === 'meal' && authoritative.aggregate.deletedAt !== null) {
					await detachMealCheckIns(database, authoritative.entityId);
				}
			}
		}
	);
};

export const applyHouseholdBootstrap = async (
	database: MaalDatabase,
	scope: HouseholdApplyScope,
	response: HouseholdBootstrapResponse,
	now = new Date()
): Promise<void> => {
	const { householdId } = scope;
	// Bootstrap pages are sorted by stable entity key for pagination, not by commit sequence.
	const { own, decoded, sharedRecipes } = decodeChanges(householdId, response.aggregates, false);
	const tables = [...new Set(decoded.map(({ store }) => database.table(store)))];
	for (const instruction of response.instructions) {
		tables.push(database.table(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[instruction.entityKind].store));
	}
	await database.transaction(
		'rw',
		[
			...new Set(tables),
			database.recipes,
			database.mealCheckIns,
			database.outbox,
			database.authSlots,
			database.syncScopes,
			database.reinstatements
		],
		async () => {
			await applySharedRecipes(database, sharedRecipes);
			const pending = await pendingHouseholdOutbox(database, householdId, [
				...decoded,
				...response.instructions
					.filter(({ action }) => action === 'delete_acknowledged_absence')
					.map(({ entityKind, entityId }) => ({
						entityKind,
						entityId,
						store: HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[entityKind].store
					}))
			]);
			const pendingKeys = new Set(pending.map((row) => keyFor(row.entityKind, row.aggregateId)));
			const current = await database.syncScopes.get(['household', householdId]);
			for (const [index, aggregate] of decoded.entries()) {
				// A device that never synced this scope never saw the deletion, so it gets no badge.
				if (current?.cursor != null) {
					await noteReinstatement(database, aggregate.store, response.aggregates[index]!, now);
				}
				const key = keyFor(aggregate.entityKind, aggregate.entityId);
				if (pendingKeys.has(key)) continue;
				await database.table(aggregate.store).put(aggregate.aggregate);
				if (aggregate.entityKind === 'meal' && aggregate.aggregate.deletedAt !== null) {
					await detachMealCheckIns(database, aggregate.entityId);
				}
			}
			for (const instruction of response.instructions) {
				const key = keyFor(instruction.entityKind, instruction.entityId);
				if (instruction.action !== 'delete_acknowledged_absence' || pendingKeys.has(key)) continue;
				await database
					.table(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[instruction.entityKind].store)
					.delete(instruction.entityId);
				if (instruction.entityKind === 'meal') {
					await detachMealCheckIns(database, instruction.entityId);
				}
			}
			await recordServerChanges(
				database,
				{ authSlotId: scope.authSlotId, scopeKind: 'household', scopeId: householdId },
				own,
				now
			);
			await database.syncScopes.put({
				scopeKind: 'household',
				scopeId: householdId,
				cursor: response.hasMore ? (current?.cursor ?? null) : response.throughSequence,
				bootstrapGeneration: response.bootstrapGeneration,
				retainedFloor: response.retainedFloor,
				state: response.hasMore ? 'bootstrapRequired' : 'syncing',
				leaseOwner: current?.leaseOwner ?? null,
				leaseExpiresAt: current?.leaseExpiresAt ?? null,
				lastSuccessAt: now.toISOString() as `${string}Z`,
				lastErrorCode: null
			});
		}
	);
};

const belongsToHousehold = async (
	database: MaalDatabase,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	record: Record<string, unknown>
): Promise<boolean> => {
	if (entityKind !== 'meal_check_in') return record.householdId === householdId;
	if (typeof record.mealId === 'string') {
		const meal = await database.meals.get(record.mealId);
		return meal?.householdId === householdId;
	}
	const row = await database.outbox
		.where('aggregateId')
		.equals(String(record.id))
		.filter(
			(candidate) =>
				candidate.scopeKind === 'household' &&
				candidate.scopeId === householdId &&
				candidate.entityKind === entityKind
		)
		.first();
	return row !== undefined;
};

export const buildHouseholdSnapshotManifest = async (
	database: MaalDatabase,
	householdId: string
): Promise<HouseholdSnapshotManifestEntry[]> => {
	const acknowledged = new Set(
		(await scopeOutbox(database, 'household', householdId, ['acknowledged'])).map((row) =>
			keyFor(row.entityKind, row.aggregateId)
		)
	);
	const manifest: HouseholdSnapshotManifestEntry[] = [];
	for (const [entityKind, descriptor] of Object.entries(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS) as [
		HouseholdSyncEntityKind,
		(typeof HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS)[HouseholdSyncEntityKind]
	][]) {
		const records = (await database.table(descriptor.store).toArray()) as Record<string, unknown>[];
		for (const record of records) {
			if (!(await belongsToHousehold(database, householdId, entityKind, record))) continue;
			const entityId = entityKind === 'household' ? record.householdId : record.id;
			const decoded = decodeHouseholdSyncAggregate(
				entityKind,
				String(entityId),
				householdId,
				record
			);
			manifest.push({
				entityKind,
				entityId: decoded.entityId,
				revision: decoded.aggregate.revision,
				updatedAt: decoded.aggregate.updatedAt as `${string}Z`,
				previousServerAck: acknowledged.has(keyFor(entityKind, decoded.entityId))
			});
		}
	}
	return manifest;
};
