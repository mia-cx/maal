import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { byOccurrence } from '$lib/client/sync/outbox.js';
import {
	LocalDecodeError,
	LocalPersistenceError,
	LocalQuotaExceededError
} from '$lib/domain/contracts/errors.js';
import {
	ConflictClockSchema,
	DomainIdSchema,
	MutableAggregateSchema,
	OutboxMutationSchema,
	UtcInstantSchema,
	type ScopeKind
} from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/schema.js';

import type { LocalStoreName, MaalDatabase } from './database.js';
import type { OutboxRecord } from './records.js';
import { runTrackedLocalCommit } from './commit-activity.js';

export type AggregateStoreName = Exclude<
	LocalStoreName,
	| 'meta'
	| 'profiles'
	| 'authSlots'
	| 'memberships'
	| 'householdInvites'
	| 'billingCapabilities'
	| 'mcpKeySummaries'
	| 'outbox'
	| 'syncScopes'
	| 'backfillCheckpoints'
	| 'uiState'
	| 'remoteProjectionMeta'
	| 'userAttributions'
>;

export interface AggregateWrite {
	store: AggregateStoreName;
	aggregateId: string;
	mutationId?: string;
	identity?: Readonly<Record<string, unknown>>;
	conflictGroups: readonly string[];
	schema: Schema.Schema.AnyNoContext;
	update: (current: unknown | undefined) => unknown;
}

export interface AdditionalOutboxMutation {
	mutationId: string;
	entityKind: string;
	aggregateId: string;
	conflictGroup: string;
	operation: 'upsert' | 'delete';
}

export interface LocalCommand {
	authSlotId: string;
	scopeKind: ScopeKind;
	scopeId: string;
	entityKind: string;
	aggregateId: string;
	conflictGroup: string;
	operation: 'upsert' | 'delete';
	originDeviceId: string;
	occurredAt?: string;
	mutationId?: string;
	payload: unknown;
	payloadSchema: Schema.Schema.AnyNoContext;
	writes: readonly AggregateWrite[];
	additionalMutations?: readonly AdditionalOutboxMutation[];
}

const isQuotaError = (error: unknown, seen = new Set<unknown>()): boolean => {
	if (typeof error !== 'object' || error === null || seen.has(error)) return false;
	seen.add(error);
	const candidate = error as {
		name?: unknown;
		message?: unknown;
		cause?: unknown;
		inner?: unknown;
		failures?: unknown;
	};
	if (
		candidate.name === 'QuotaExceededError' ||
		candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		(typeof candidate.message === 'string' && candidate.message.includes('QuotaExceededError'))
	) {
		return true;
	}
	if (isQuotaError(candidate.cause, seen) || isQuotaError(candidate.inner, seen)) return true;
	return (
		Array.isArray(candidate.failures) &&
		candidate.failures.some((failure) => isQuotaError(failure, seen))
	);
};

const hasLocalErrorTag = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && '_tag' in error;

const decode = <A, I>(schema: Schema.Schema<A, I>, input: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(input);
	} catch {
		throw new LocalDecodeError({
			operation,
			message: 'Local data did not match its contract.'
		});
	}
};

const encode = <A, I>(schema: Schema.Schema<A, I>, value: A, operation: string): I => {
	try {
		return Schema.encodeSync(schema)(value);
	} catch {
		throw new LocalDecodeError({
			operation,
			message: 'Local data could not be encoded for storage.'
		});
	}
};

export interface LocalCommandResult {
	mutationId: string;
	aggregates: readonly unknown[];
}

const prepareCommand = (command: LocalCommand) => {
	const mutationId = decode(DomainIdSchema, command.mutationId ?? uuidv7(), 'decode mutation ID');
	const occurredAt = decode(
		UtcInstantSchema,
		command.occurredAt ?? new Date().toISOString(),
		'decode mutation time'
	);
	const originDeviceId = decode(DomainIdSchema, command.originDeviceId, 'decode device ID');
	const decodedPayload = decode(command.payloadSchema, command.payload, 'decode command payload');
	const encodedPayload = encode(command.payloadSchema, decodedPayload, 'encode command payload');
	return { command, mutationId, occurredAt, originDeviceId, encodedPayload };
};

const commitPreparedCommand = async (
	database: MaalDatabase,
	{
		command,
		mutationId,
		occurredAt,
		originDeviceId,
		encodedPayload
	}: ReturnType<typeof prepareCommand>
): Promise<LocalCommandResult> => {
	const clockFor = (candidateMutationId: string) =>
		decode(
			ConflictClockSchema,
			{
				mutationId: decode(DomainIdSchema, candidateMutationId, 'decode related mutation ID'),
				occurredAt,
				originDeviceId
			},
			'decode conflict clock'
		);
	const aggregates: unknown[] = [];

	for (const write of command.writes) {
		const clock = clockFor(write.mutationId ?? mutationId);
		const table = database.table(write.store);
		// A deferred household edit may no longer be the shared record after another profile's pull.
		// Continue this slot's newest intent, not an older snapshot or the pulled replacement.
		const pending =
			command.scopeKind === 'household'
				? await database.outbox
						.where('aggregateId')
						.equals(write.aggregateId)
						.filter(
							(row) =>
								row.scopeKind === command.scopeKind &&
								row.scopeId === command.scopeId &&
								(row.status === 'pending' ||
									row.status === 'sending' ||
									row.status === 'quarantined') &&
								row.backfill !== true
						)
						.toArray()
				: [];
		const deferred = pending
			.filter((row) => row.authSlotId === command.authSlotId)
			.toSorted(byOccurrence)
			.at(-1);
		const shared = await table.get(write.aggregateId);
		// A shared write must not erase another slot's unsent edits, including restored intent.
		for (const row of pending) {
			if (row.authSlotId !== command.authSlotId && row.snapshot === undefined) {
				await database.outbox.update(row.mutationId, { snapshot: shared });
			}
		}
		const stored = deferred?.snapshot ?? shared;
		const current = stored
			? decode(write.schema, stored, `decode ${write.store} aggregate`)
			: undefined;
		const currentMetadata = stored
			? decode(MutableAggregateSchema, stored, `decode ${write.store} metadata`)
			: undefined;
		const candidate = write.update(current);
		if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
			throw new LocalDecodeError({
				operation: `update ${write.store} aggregate`,
				message: 'A local command returned an invalid aggregate.'
			});
		}

		const next = decode(
			write.schema,
			{
				...candidate,
				...(write.identity ?? { id: write.aggregateId }),
				schemaVersion: CURRENT_SCHEMA_VERSION,
				revision: (currentMetadata?.revision ?? 0) + 1,
				createdAt: currentMetadata?.createdAt ?? occurredAt,
				updatedAt: occurredAt,
				conflictClocks: {
					...(currentMetadata?.conflictClocks ?? {}),
					...Object.fromEntries(write.conflictGroups.map((group) => [group, clock]))
				}
			},
			`decode updated ${write.store} aggregate`
		);
		const encoded = encode(write.schema, next, `encode updated ${write.store} aggregate`);

		await table.put(encoded);
		aggregates.push(next);
	}

	const mutationInputs = [
		{
			mutationId,
			entityKind: command.entityKind,
			aggregateId: command.aggregateId,
			conflictGroup: command.conflictGroup,
			operation: command.operation
		},
		...(command.additionalMutations ?? [])
	];
	const outboxRecords = mutationInputs.map((input): OutboxRecord => {
		const mutation = decode(
			OutboxMutationSchema,
			{
				schemaVersion: CURRENT_SCHEMA_VERSION,
				...input,
				authSlotId: command.authSlotId,
				scopeKind: command.scopeKind,
				scopeId: command.scopeId,
				occurredAt,
				originDeviceId,
				payload: encodedPayload
			},
			'decode outbox mutation'
		);
		return {
			...mutation,
			status: 'pending',
			nextAttemptAt: occurredAt,
			attempts: 0
		};
	});
	await database.outbox.bulkAdd(outboxRecords);

	return { mutationId, aggregates };
};

/**
 * Commits every command of one user gesture in a single Dexie transaction, so aggregates and outbox rows
 * across stores and sync scopes (user recipe plus household meals) land together or not at all.
 * Results follow the order of `commands`.
 */
export const executeLocalCommands = async (
	database: MaalDatabase,
	commands: readonly LocalCommand[]
): Promise<LocalCommandResult[]> => {
	const prepared = commands.map(prepareCommand);
	const tables = [
		...new Set(commands.flatMap(({ writes }) => writes.map(({ store }) => database.table(store))))
	];

	try {
		return await runTrackedLocalCommit(database.name, 'commit local command', () =>
			database.transaction('rw', [...tables, database.outbox], async () => {
				const results: LocalCommandResult[] = [];
				for (const command of prepared)
					results.push(await commitPreparedCommand(database, command));
				return results;
			})
		);
	} catch (error) {
		if (hasLocalErrorTag(error)) throw error;
		if (isQuotaError(error)) {
			throw new LocalQuotaExceededError({
				operation: 'commit local command',
				message: 'The device has no storage available. No local changes were saved.'
			});
		}
		throw new LocalPersistenceError({
			operation: 'commit local command',
			message: 'The local command could not be saved.'
		});
	}
};

export const executeLocalCommand = async (
	database: MaalDatabase,
	command: LocalCommand
): Promise<LocalCommandResult> => (await executeLocalCommands(database, [command]))[0]!;

export type { LocalStoreName };
