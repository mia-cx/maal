import type {
	MutationReceipt,
	SnapshotManifestEntry,
	SyncChange,
	SyncMutation,
	UserSyncEntityKind
} from '$lib/sync/contracts.js';

export interface ServerSyncScopeState {
	readonly retainedFloor: number;
	readonly latestSequence: number;
	readonly bootstrapGeneration: number;
}

export interface ServerSyncPage extends ServerSyncScopeState {
	readonly changes: readonly SyncChange[];
	readonly throughSequence: number;
	readonly hasMore: boolean;
}

export interface ServerBootstrapSnapshot extends ServerSyncScopeState {
	readonly aggregates: readonly SyncChange[];
	readonly authoritativeIds: ReadonlySet<string>;
}

export type SyncCommitMode = 'live' | 'backfill';

export interface UserSyncRepository {
	readScopeState(workosUserId: string): Promise<ServerSyncScopeState>;
	pull(workosUserId: string, after: number, limit: number): Promise<ServerSyncPage>;
	bootstrap(workosUserId: string): Promise<ServerBootstrapSnapshot>;
	commit(input: {
		readonly actorUserId: string;
		readonly deviceId: string;
		readonly mutation: SyncMutation;
		readonly mode: SyncCommitMode;
		readonly receivedAt: string;
	}): Promise<MutationReceipt>;
	prune(input: { readonly now: string; readonly changeCutoff: string }): Promise<void>;
}

export const syncEntityKey = (kind: UserSyncEntityKind, id: string): string => `${kind}\u0000${id}`;

export const reconciliationInstructions = (
	manifest: readonly SnapshotManifestEntry[],
	authoritativeIds: ReadonlySet<string>
) =>
	manifest
		.filter(
			({ entityKind, entityId }) => !authoritativeIds.has(syncEntityKey(entityKind, entityId))
		)
		.map(({ entityKind, entityId, previousServerAck }) => ({
			entityKind,
			entityId,
			action: previousServerAck
				? ('delete_acknowledged_absence' as const)
				: ('keep_for_backfill' as const)
		}));
