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

export interface ServerBootstrapPageRequest {
	readonly afterEntityKey: string | null;
	readonly limit: number;
	/** Local identities to check against the server; only the first page carries them. */
	readonly manifest: readonly Pick<SnapshotManifestEntry, 'entityKind' | 'entityId'>[];
}

export interface ServerBootstrapPage extends ServerSyncScopeState {
	/** At most `limit` held aggregates after `afterEntityKey`, in entity-key order. */
	readonly aggregates: readonly SyncChange[];
	/** The keys of the requested manifest entries the user still holds. */
	readonly authoritativeIds: ReadonlySet<string>;
	/** The key to request the next page after, or null on the last page. */
	readonly nextEntityKey: string | null;
}

export type SyncCommitMode = 'live' | 'backfill';

export interface UserSyncRepository {
	readScopeState(workosUserId: string): Promise<ServerSyncScopeState>;
	pull(workosUserId: string, after: number, limit: number): Promise<ServerSyncPage>;
	bootstrap(workosUserId: string, page: ServerBootstrapPageRequest): Promise<ServerBootstrapPage>;
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
