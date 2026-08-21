import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

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
>;

export interface AggregateWrite {
	store: AggregateStoreName;
	aggregateId: string;
	identity?: Readonly<Record<string, unknown>>;
	conflictGroups: readonly string[];
	schema: Schema.Schema.AnyNoContext;
	update: (current: unknown | undefined) => unknown;
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

export const executeLocalCommand = async (
	database: MaalDatabase,
	command: LocalCommand
): Promise<{ mutationId: string; aggregates: readonly unknown[] }> => {
	const mutationId = decode(DomainIdSchema, command.mutationId ?? uuidv7(), 'decode mutation ID');
	const occurredAt = decode(
		UtcInstantSchema,
		command.occurredAt ?? new Date().toISOString(),
		'decode mutation time'
	);
	const originDeviceId = decode(DomainIdSchema, command.originDeviceId, 'decode device ID');
	const clock = decode(
		ConflictClockSchema,
		{ mutationId, occurredAt, originDeviceId },
		'decode conflict clock'
	);
	const decodedPayload = decode(command.payloadSchema, command.payload, 'decode command payload');
	const encodedPayload = encode(command.payloadSchema, decodedPayload, 'encode command payload');
	const tables = [...new Set(command.writes.map(({ store }) => database.table(store)))];

	try {
		return await database.transaction('rw', [...tables, database.outbox], async () => {
			const aggregates: unknown[] = [];

			for (const write of command.writes) {
				const table = database.table(write.store);
				const stored = await table.get(write.aggregateId);
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

			const mutation = decode(
				OutboxMutationSchema,
				{
					schemaVersion: CURRENT_SCHEMA_VERSION,
					mutationId,
					authSlotId: command.authSlotId,
					scopeKind: command.scopeKind,
					scopeId: command.scopeId,
					entityKind: command.entityKind,
					aggregateId: command.aggregateId,
					conflictGroup: command.conflictGroup,
					operation: command.operation,
					occurredAt,
					originDeviceId,
					payload: encodedPayload
				},
				'decode outbox mutation'
			);
			const outboxRecord: OutboxRecord = {
				...mutation,
				status: 'pending',
				nextAttemptAt: occurredAt,
				attempts: 0
			};
			await database.outbox.add(outboxRecord);

			return { mutationId, aggregates };
		});
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

export type { LocalStoreName };
