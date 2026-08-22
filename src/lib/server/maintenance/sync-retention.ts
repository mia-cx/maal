export type SyncAudienceKind = 'user' | 'household';

interface ChangeRetentionRow {
	seq: number;
	audience_id: string;
}

interface RowIdRetentionRow {
	row_id: number;
}

export interface SyncRetentionBatchResult {
	readonly audienceKind: SyncAudienceKind;
	readonly serverNow: string;
	readonly changesDeleted: number;
	readonly receiptsDeleted: number;
	readonly tombstonesDeleted: number;
	readonly scopesAdvanced: number;
}

const validateBatchSize = (batchSize: number): number => {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
		throw new TypeError('Sync retention batch size must be between 1 and 500.');
	}
	return batchSize;
};

export const readD1ServerNow = async (database: D1Database): Promise<string> => {
	const row = await database
		.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")
		.first<{ now: string }>();
	if (!row?.now) throw new TypeError('D1 did not return its server time.');
	return row.now;
};

const deleteRows = async (
	database: D1Database,
	table: 'sync_mutation_receipts' | 'sync_tombstones',
	rowIds: readonly number[]
): Promise<number> => {
	if (rowIds.length === 0) return 0;
	const placeholders = rowIds.map(() => '?').join(', ');
	const result = await database
		.prepare(`DELETE FROM ${table} WHERE rowid IN (${placeholders})`)
		.bind(...rowIds)
		.run();
	return result.meta.changes;
};

const deleteChangesAndAdvanceFloors = async (
	database: D1Database,
	input: {
		readonly audienceKind: SyncAudienceKind;
		readonly now: string;
		readonly changes: readonly ChangeRetentionRow[];
	}
): Promise<number> => {
	if (input.changes.length === 0) return 0;
	const placeholders = input.changes.map(() => '?').join(', ');
	const affectedScopes = [...new Set(input.changes.map(({ audience_id }) => audience_id))];
	const results = await database.batch([
		database
			.prepare(`DELETE FROM sync_changes WHERE rowid IN (${placeholders})`)
			.bind(...input.changes.map(({ seq }) => seq)),
		...affectedScopes.map((audienceId) =>
			database
				.prepare(
					`UPDATE sync_scope_state SET
					 bootstrap_generation = bootstrap_generation + CASE
					  WHEN earliest_retained_sequence != COALESCE(
					   (SELECT MIN(seq) FROM sync_changes
					    WHERE audience_kind = ? AND audience_id = ?), latest_sequence)
					  THEN 1 ELSE 0 END,
					 earliest_retained_sequence = COALESCE(
					  (SELECT MIN(seq) FROM sync_changes WHERE audience_kind = ? AND audience_id = ?),
					  latest_sequence),
					 updated_at = ?
					 WHERE audience_kind = ? AND audience_id = ?`
				)
				.bind(
					input.audienceKind,
					audienceId,
					input.audienceKind,
					audienceId,
					input.now,
					input.audienceKind,
					audienceId
				)
		)
	]);
	return results[0]?.meta.changes ?? 0;
};

export const pruneSyncRetentionBatch = async (
	database: D1Database,
	input: {
		readonly audienceKind: SyncAudienceKind;
		readonly now: string;
		readonly changeCutoff: string;
		readonly batchSize?: number;
	}
): Promise<SyncRetentionBatchResult> => {
	const batchSize = validateBatchSize(input.batchSize ?? 100);
	const changes = (
		await database
			.prepare(
				`SELECT rowid AS seq, audience_id FROM sync_changes
				 WHERE audience_kind = ? AND (
				  (tombstone_expires_at IS NULL AND received_at < ?)
				  OR (tombstone_expires_at IS NOT NULL AND tombstone_expires_at <= ?)
				 ) ORDER BY seq LIMIT ?`
			)
			.bind(input.audienceKind, input.changeCutoff, input.now, batchSize)
			.all<ChangeRetentionRow>()
	).results;
	const affectedScopes = [...new Set(changes.map(({ audience_id }) => audience_id))];
	const changesDeleted = await deleteChangesAndAdvanceFloors(database, {
		audienceKind: input.audienceKind,
		now: input.now,
		changes
	});

	const receiptRows = (
		await database
			.prepare(
				`SELECT rowid AS row_id FROM sync_mutation_receipts
				 WHERE audience_kind = ? AND retain_until <= ? ORDER BY retain_until, rowid LIMIT ?`
			)
			.bind(input.audienceKind, input.now, batchSize)
			.all<RowIdRetentionRow>()
	).results;
	const receiptsDeleted = await deleteRows(
		database,
		'sync_mutation_receipts',
		receiptRows.map(({ row_id }) => row_id)
	);

	const tombstoneRows = (
		await database
			.prepare(
				`SELECT rowid AS row_id FROM sync_tombstones
				 WHERE audience_kind = ? AND expires_at <= ? ORDER BY expires_at, rowid LIMIT ?`
			)
			.bind(input.audienceKind, input.now, batchSize)
			.all<RowIdRetentionRow>()
	).results;
	const tombstonesDeleted = await deleteRows(
		database,
		'sync_tombstones',
		tombstoneRows.map(({ row_id }) => row_id)
	);

	return {
		audienceKind: input.audienceKind,
		serverNow: input.now,
		changesDeleted,
		receiptsDeleted,
		tombstonesDeleted,
		scopesAdvanced: affectedScopes.length
	};
};

export const runScheduledSyncRetention = async (
	database: D1Database,
	batchSize = 250
): Promise<readonly SyncRetentionBatchResult[]> => {
	const serverNow = await readD1ServerNow(database);
	const changeCutoff = new Date(Date.parse(serverNow) - 90 * 86_400_000).toISOString();
	const results: SyncRetentionBatchResult[] = [];
	for (const audienceKind of ['user', 'household'] as const) {
		results.push(
			await pruneSyncRetentionBatch(database, {
				audienceKind,
				now: serverNow,
				changeCutoff,
				batchSize
			})
		);
	}
	return results;
};
