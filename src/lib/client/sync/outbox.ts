import type { MaalDatabase } from '$lib/client/local/database.js';
import type { OutboxRecord, OutboxStatus } from '$lib/client/local/records.js';
import type { ScopeKind } from '$lib/domain/contracts/primitives.js';
import { SyncTransportError, type MutationReceipt } from '$lib/sync/contracts.js';

/** Most coalesced mutations one push request carries. */
export const PUSH_BATCH_SIZE = 50;

/**
 * Server error codes that blame the content of a request's mutations rather than the request as a
 * whole. Only these are worth splitting a batch over; anything else (a protocol mismatch after a
 * deploy, say) would fail every mutation alike and must leave the rows pending.
 */
const MUTATION_REJECTION_CODES: ReadonlySet<string> = new Set([
	'invalid_complete_aggregate',
	'invalid_household_aggregate',
	'body_too_large'
]);

const utc = (date: Date): `${string}Z` => date.toISOString() as `${string}Z`;

export const retryDelay = (attempt: number): number =>
	Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads one scope's outbox rows in the given statuses through the `[scopeKind+scopeId+status]` index. */
export const scopeOutbox = (
	database: MaalDatabase,
	scopeKind: ScopeKind,
	scopeId: string,
	statuses: readonly OutboxStatus[] = ['pending', 'sending']
): Promise<OutboxRecord[]> =>
	database.outbox
		.where('[scopeKind+scopeId+status]')
		.anyOf(statuses.map((status) => [scopeKind, scopeId, status]))
		.toArray();

/** Oldest first: the order a scope's local intent happened in. */
export const byOccurrence = (left: OutboxRecord, right: OutboxRecord): number =>
	Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
	left.mutationId.localeCompare(right.mutationId);

/** The conflict group that carries `deletedAt` for an entity with these groups. */
export const deletionGroupFor = (groups: readonly string[]): string =>
	groups.includes('deletion') ? 'deletion' : groups[0]!;

/** The current local record an outbox row would be sent with. */
export interface OutboxAggregate {
	readonly aggregate: Record<string, unknown> & { readonly deletedAt: string | null };
	readonly deletionGroup: string;
}

/** One mutation to send, standing for its host row and every earlier row it supersedes. */
export interface CoalescedMutation {
	readonly host: OutboxRecord;
	/** Earlier rows whose every change the host already carries. They take the host's receipt. */
	readonly folded: readonly OutboxRecord[];
	readonly conflictGroups: readonly [string, ...string[]];
	readonly operation: 'upsert' | 'delete';
	readonly aggregate: Record<string, unknown>;
}

const ownedGroups = (row: OutboxRecord, aggregate: Record<string, unknown>): string[] => {
	if (Array.isArray(row.backfillConflictGroups)) {
		return row.backfillConflictGroups.filter((group): group is string => typeof group === 'string');
	}
	const clocks = aggregate.conflictClocks;
	if (!isRecord(clocks)) return [];
	return Object.entries(clocks)
		.filter(([, clock]) => isRecord(clock) && clock.mutationId === row.mutationId)
		.map(([group]) => group);
};

/**
 * Turns a scope's pending rows into mutations that match the current local record.
 *
 * Every row of an aggregate is sent with the same current record, so a row must only claim the
 * conflict groups whose clock it still owns. A row that owns none was overwritten by a later local
 * write and folds into the next row sent for that aggregate; so does every earlier row of a purged
 * record, which has no fields left to send. Only a mutation that owns the group carrying `deletedAt`
 * may say `delete`: an earlier edit of a since-trashed record goes up as the edit it was, ahead of
 * the deletion, so the server's operation/`deletedAt` check passes and no edit is lost on restore.
 *
 * `load` receives each aggregate's newest row. The result keeps the scope's occurrence order.
 */
export const coalesceOutbox = async (
	rows: readonly OutboxRecord[],
	load: (newest: OutboxRecord) => Promise<OutboxAggregate>
): Promise<CoalescedMutation[]> => {
	const ordered = rows.toSorted(byOccurrence);
	const byAggregate = Map.groupBy(ordered, (row) => `${row.entityKind}\u0000${row.aggregateId}`);
	const planned: CoalescedMutation[] = [];
	for (const group of byAggregate.values()) {
		const { aggregate, deletionGroup } = await load(group.at(-1)!);
		const purged = 'purgedAt' in aggregate;
		let folded: OutboxRecord[] = [];
		for (const [index, row] of group.entries()) {
			const owned = ownedGroups(row, aggregate);
			if (index < group.length - 1 && (purged || owned.length === 0)) {
				folded.push(row);
				continue;
			}
			const conflictGroups = (owned.length > 0 ? owned : [row.conflictGroup]) as [
				string,
				...string[]
			];
			const ownsDeletion = purged || conflictGroups.includes(deletionGroup);
			planned.push({
				host: row,
				folded,
				conflictGroups,
				operation: ownsDeletion && aggregate.deletedAt !== null ? 'delete' : 'upsert',
				aggregate:
					ownsDeletion || aggregate.deletedAt === null
						? aggregate
						: { ...aggregate, deletedAt: null }
			});
			folded = [];
		}
	}
	return planned.toSorted((left, right) => byOccurrence(left.host, right.host));
};

/** Every row a coalesced mutation answers for. */
export const coveredRows = (planned: readonly CoalescedMutation[]): OutboxRecord[] =>
	planned.flatMap(({ host, folded }) => [host, ...folded]);

/** The server's receipts, copied onto the folded rows each one also answers for. */
export const expandReceipts = (
	planned: readonly CoalescedMutation[],
	receipts: readonly MutationReceipt[]
): MutationReceipt[] => {
	const byMutation = new Map(receipts.map((receipt) => [receipt.mutationId, receipt]));
	return planned.flatMap(({ host, folded }) => {
		const receipt = byMutation.get(host.mutationId);
		if (!receipt) return [];
		return [receipt, ...folded.map(({ mutationId }) => ({ ...receipt, mutationId }))];
	});
};

/** One push batch: what committed, and the first rejection code to show on the scope. */
export interface PushOutcome {
	readonly committedThrough: number | null;
	readonly rejectionCode: string | null;
}

/** The first rejection among receipts, for the scope's `lastErrorCode`. */
export const firstRejectionCode = (receipts: readonly MutationReceipt[]): string | null =>
	receipts.flatMap((receipt) => ('errorCode' in receipt ? [receipt.errorCode] : []))[0] ?? null;

export interface IsolatedPush {
	readonly receipts: readonly MutationReceipt[];
	/** The highest through-sequence of any request that committed, or null when none did. */
	readonly committedThrough: number | null;
}

/**
 * Sends mutations in one request. When the server refuses the whole request for the content of a
 * mutation, the batch is halved until the refused mutation stands alone; it then gets a local
 * `rejected` receipt carrying the server's code, and the rest still commit.
 */
export const pushIsolatingRejections = async <M extends { readonly mutationId: string }>(
	mutations: readonly M[],
	push: (
		batch: readonly M[]
	) => Promise<{ readonly receipts: readonly MutationReceipt[]; readonly committedThrough: number }>
): Promise<IsolatedPush> => {
	try {
		return await push(mutations);
	} catch (error) {
		if (
			!(error instanceof SyncTransportError) ||
			error.retryable ||
			!MUTATION_REJECTION_CODES.has(error.code)
		) {
			throw error;
		}
		if (mutations.length === 1) {
			return {
				receipts: [
					{
						mutationId: mutations[0]!.mutationId,
						status: 'rejected',
						sequence: null,
						resultingRevision: null,
						errorCode: error.code
					}
				],
				committedThrough: null
			};
		}
		const middle = Math.ceil(mutations.length / 2);
		const first = await pushIsolatingRejections(mutations.slice(0, middle), push);
		const second = await pushIsolatingRejections(mutations.slice(middle), push);
		const committed = [first.committedThrough, second.committedThrough].filter(
			(sequence): sequence is number => sequence !== null
		);
		return {
			receipts: [...first.receipts, ...second.receipts],
			committedThrough: committed.length > 0 ? Math.max(...committed) : null
		};
	}
};

export const markSending = async (
	database: MaalDatabase,
	rows: readonly OutboxRecord[]
): Promise<void> => {
	await database.transaction('rw', database.outbox, async () => {
		for (const row of rows) await database.outbox.update(row.mutationId, { status: 'sending' });
	});
};

/** Puts rows back to `pending` with exponential backoff; backfill rows wait at least `backfillIntervalMs`. */
export const requeue = async (
	database: MaalDatabase,
	rows: readonly OutboxRecord[],
	now: Date,
	backfillIntervalMs: number
): Promise<void> => {
	await database.transaction('rw', database.outbox, async () => {
		for (const row of rows) {
			const attempts = row.attempts + 1;
			const delay =
				row.backfill === true
					? Math.max(backfillIntervalMs, retryDelay(attempts))
					: retryDelay(attempts);
			await database.outbox.update(row.mutationId, {
				status: 'pending',
				attempts,
				nextAttemptAt: utc(new Date(now.getTime() + delay))
			});
		}
	});
};

/**
 * Requeues the sent rows that got no receipt, so a short server answer can never leave a row
 * `sending` and selected again in the same drain.
 */
export const requeueUnanswered = async (
	database: MaalDatabase,
	sent: readonly OutboxRecord[],
	receipts: readonly MutationReceipt[],
	now: Date,
	backfillIntervalMs: number
): Promise<void> => {
	const answered = new Set(receipts.map(({ mutationId }) => mutationId));
	const unanswered = sent.filter(({ mutationId }) => !answered.has(mutationId));
	if (unanswered.length > 0) await requeue(database, unanswered, now, backfillIntervalMs);
};

const acknowledgedOrder = (left: OutboxRecord, right: OutboxRecord): number =>
	Number(right.acknowledgedSequence ?? -1) - Number(left.acknowledgedSequence ?? -1) ||
	byOccurrence(right, left);

/**
 * Keeps one acknowledged row per aggregate, the newest, without its payload or snapshots. That row
 * is the device's record that the server has the aggregate: bootstrap manifests, recipe retention
 * and archive import read it. Older acknowledged rows add nothing. Call inside a transaction that
 * includes the outbox.
 */
export const pruneAcknowledgedOutbox = async (
	database: MaalDatabase,
	acknowledged: readonly OutboxRecord[]
): Promise<void> => {
	const aggregates = new Map(
		acknowledged.map((row) => [
			`${row.scopeKind}\u0000${row.scopeId}\u0000${row.entityKind}\u0000${row.aggregateId}`,
			row
		])
	);
	for (const { scopeKind, scopeId, entityKind, aggregateId } of aggregates.values()) {
		const rows = await database.outbox
			.where('aggregateId')
			.equals(aggregateId)
			.filter(
				(row) =>
					row.status === 'acknowledged' &&
					row.scopeKind === scopeKind &&
					row.scopeId === scopeId &&
					row.entityKind === entityKind
			)
			.toArray();
		const [newest, ...older] = rows.toSorted(acknowledgedOrder);
		if (!newest) continue;
		await database.outbox.bulkDelete(older.map(({ mutationId }) => mutationId));
		await database.outbox.update(newest.mutationId, {
			payload: null,
			snapshot: undefined,
			authoritativeSnapshot: undefined
		});
	}
};
