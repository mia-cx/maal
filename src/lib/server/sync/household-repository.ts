import type { MutationReceipt } from '$lib/sync/contracts.js';
import type {
	HouseholdSnapshotManifestEntry,
	HouseholdSyncChange,
	HouseholdSyncEntityKind,
	HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';

export interface HouseholdServerSyncScopeState {
	readonly retainedFloor: number;
	readonly latestSequence: number;
	readonly bootstrapGeneration: number;
}

export interface HouseholdServerSyncPage extends HouseholdServerSyncScopeState {
	readonly changes: readonly HouseholdSyncChange[];
	readonly throughSequence: number;
	readonly hasMore: boolean;
}

export interface HouseholdServerBootstrapSnapshot extends HouseholdServerSyncScopeState {
	readonly aggregates: readonly HouseholdSyncChange[];
	readonly authoritativeIds: ReadonlySet<string>;
}

export interface HouseholdSyncRepository {
	readScopeState(householdId: string): Promise<HouseholdServerSyncScopeState>;
	pull(householdId: string, after: number, limit: number): Promise<HouseholdServerSyncPage>;
	bootstrap(householdId: string): Promise<HouseholdServerBootstrapSnapshot>;
	commit(input: {
		readonly householdId: string;
		readonly actorUserId: string;
		readonly deviceId: string;
		readonly mutation: HouseholdSyncMutation;
		readonly mode: 'live' | 'backfill';
		readonly receivedAt: string;
	}): Promise<MutationReceipt>;
	prune(input: { readonly now: string; readonly changeCutoff: string }): Promise<void>;
}

export const householdSyncEntityKey = (kind: HouseholdSyncEntityKind, id: string): string =>
	`${kind}\u0000${id}`;

export const householdReconciliationInstructions = (
	manifest: readonly HouseholdSnapshotManifestEntry[],
	authoritativeIds: ReadonlySet<string>
) =>
	manifest
		.filter(
			({ entityKind, entityId }) =>
				!authoritativeIds.has(householdSyncEntityKey(entityKind, entityId))
		)
		.map(({ entityKind, entityId, previousServerAck }) => ({
			entityKind,
			entityId,
			action: previousServerAck
				? ('delete_acknowledged_absence' as const)
				: ('keep_for_backfill' as const)
		}));
