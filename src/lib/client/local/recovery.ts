import { Schema } from 'effect';

import { LocalDecodeError, LocalRecoveryConfirmationError } from '$lib/domain/contracts/errors.js';

import type { LocalStoreName, MaalDatabase } from './database.js';
import type { MetaRecord } from './records.js';

export interface RecoveryState {
	state: 'ready' | 'required';
	code?: string;
	detectedAt?: string;
}

export interface RecoveryExport {
	databaseName: string;
	createdAt: string;
	records: Partial<Record<LocalStoreName, readonly unknown[]>>;
	skipped: Partial<Record<LocalStoreName, number>>;
}

export type RecoveryDecoders = Partial<Record<LocalStoreName, Schema.Schema.AnyNoContext>>;

export interface RecoveryExportOptions {
	readonly batchSize?: number;
}

export const RECOVERY_EXPORT_BATCH_SIZE = 250;

const utcNow = (): `${string}Z` => new Date().toISOString() as `${string}Z`;

export const markRecoveryRequired = async (database: MaalDatabase, code: string): Promise<void> => {
	const record: MetaRecord = {
		key: 'recoveryState',
		value: { state: 'required', code, detectedAt: utcNow() } satisfies RecoveryState,
		updatedAt: utcNow()
	};
	await database.meta.put(record);
};

export const readRecoveryState = async (database: MaalDatabase): Promise<RecoveryState> => {
	const record = await database.meta.get('recoveryState');
	if (!record) return { state: 'ready' };
	try {
		return Schema.decodeUnknownSync(
			Schema.Union(
				Schema.Struct({ state: Schema.Literal('ready') }),
				Schema.Struct({
					state: Schema.Literal('required'),
					code: Schema.String,
					detectedAt: Schema.String
				})
			)
		)(record.value);
	} catch {
		throw new LocalDecodeError({
			operation: 'decode recovery state',
			message: 'The local recovery state is malformed.'
		});
	}
};

export const exportDecodableRecoveryData = async (
	database: Pick<MaalDatabase, 'name' | 'table'>,
	decoders: RecoveryDecoders,
	options: RecoveryExportOptions = {}
): Promise<RecoveryExport> => {
	const records: RecoveryExport['records'] = {};
	const skipped: RecoveryExport['skipped'] = {};
	const batchSize = Math.max(1, Math.min(options.batchSize ?? RECOVERY_EXPORT_BATCH_SIZE, 1_000));

	for (const [name, schema] of Object.entries(decoders) as [
		LocalStoreName,
		Schema.Schema.AnyNoContext
	][]) {
		const decoded: unknown[] = [];
		let skippedCount = 0;
		try {
			let offset = 0;
			while (true) {
				const rawRecords = await database
					.table(name)
					.toCollection()
					.offset(offset)
					.limit(batchSize)
					.toArray();
				for (const rawRecord of rawRecords) {
					try {
						decoded.push(Schema.decodeUnknownSync(schema)(rawRecord));
					} catch {
						skippedCount += 1;
					}
				}
				offset += rawRecords.length;
				if (rawRecords.length < batchSize) break;
			}
		} catch {
			// Recovery mode may be opening an older schema that never had this table.
			continue;
		}
		records[name] = decoded;
		if (skippedCount > 0) skipped[name] = skippedCount;
	}

	return {
		databaseName: database.name,
		createdAt: utcNow(),
		records,
		skipped
	};
};

export const getRecoveryResetConfirmation = (database: Pick<MaalDatabase, 'name'>): string =>
	`RESET ${database.name}`;

export const resetRecoveredDatabase = async (
	database: Pick<MaalDatabase, 'name' | 'delete'>,
	confirmation: string
): Promise<void> => {
	if (confirmation !== getRecoveryResetConfirmation(database)) {
		throw new LocalRecoveryConfirmationError({
			operation: 'reset local database',
			message: 'The recovery reset confirmation did not match.'
		});
	}
	await database.delete();
};
