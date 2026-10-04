import { Data, Schema } from 'effect';

import { DomainIdSchema, UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import {
	CURRENT_PROTOCOL_VERSION,
	CURRENT_SCHEMA_VERSION
} from '$lib/domain/contracts/versions.js';

export const USER_SYNC_ENTITY_KINDS = [
	'recipe',
	'foodUserAlias',
	'foodUserEntry',
	'unitUserAlias',
	'unitUserEntry',
	'userFoodPreference',
	'userFoodDisplayPreference',
	'userUnitDisplayPreference'
] as const;

export const UserSyncEntityKindSchema = Schema.Literal(...USER_SYNC_ENTITY_KINDS);
export type UserSyncEntityKind = typeof UserSyncEntityKindSchema.Type;

export const UserSyncAudienceSchema = Schema.Struct({
	kind: Schema.Literal('user'),
	id: Schema.String.pipe(Schema.minLength(1))
});
export type UserSyncAudience = typeof UserSyncAudienceSchema.Type;

const CursorSchema = Schema.NonNegativeInt;
const NullableCursorSchema = Schema.NullOr(CursorSchema);
const ProtocolVersionSchema = Schema.Literal(CURRENT_PROTOCOL_VERSION);

export const SyncMutationSchema = Schema.Struct({
	schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
	mutationId: DomainIdSchema,
	originDeviceId: DomainIdSchema,
	entityKind: UserSyncEntityKindSchema,
	entityId: DomainIdSchema,
	conflictGroups: Schema.NonEmptyArray(Schema.String.pipe(Schema.minLength(1))),
	operation: Schema.Literal('upsert', 'delete'),
	occurredAt: UtcInstantSchema,
	aggregate: Schema.Unknown
});
export type SyncMutation = typeof SyncMutationSchema.Type;

export const PushRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: UserSyncAudienceSchema,
	baseCursor: NullableCursorSchema,
	mutations: Schema.Array(SyncMutationSchema).pipe(Schema.maxItems(50))
});
export type PushRequest = typeof PushRequestSchema.Type;

export const MutationReceiptSchema = Schema.Union(
	Schema.Struct({
		mutationId: DomainIdSchema,
		status: Schema.Literal('accepted', 'duplicate'),
		sequence: CursorSchema,
		resultingRevision: Schema.NonNegativeInt
	}),
	Schema.Struct({
		mutationId: DomainIdSchema,
		status: Schema.Literal('rejected'),
		sequence: Schema.Null,
		resultingRevision: Schema.Null,
		errorCode: Schema.String.pipe(Schema.minLength(1))
	})
);
export type MutationReceipt = typeof MutationReceiptSchema.Type;

export const PushResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	receipts: Schema.Array(MutationReceiptSchema),
	committedThrough: CursorSchema
});
export type PushResponse = typeof PushResponseSchema.Type;

export const PullRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: UserSyncAudienceSchema,
	after: CursorSchema,
	limit: Schema.Int.pipe(Schema.between(1, 100))
});
export type PullRequest = typeof PullRequestSchema.Type;

export const SyncChangeSchema = Schema.Struct({
	sequence: CursorSchema,
	mutationId: DomainIdSchema,
	originDeviceId: DomainIdSchema,
	entityKind: UserSyncEntityKindSchema,
	entityId: DomainIdSchema,
	conflictGroups: Schema.NonEmptyArray(Schema.String.pipe(Schema.minLength(1))),
	operation: Schema.Literal('upsert', 'delete'),
	resultingRevision: Schema.NonNegativeInt,
	occurredAt: UtcInstantSchema,
	receivedAt: UtcInstantSchema,
	aggregate: Schema.Unknown,
	tombstoneExpiresAt: Schema.NullOr(UtcInstantSchema)
});
export type SyncChange = typeof SyncChangeSchema.Type;

export const PullResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	changes: Schema.Array(SyncChangeSchema),
	throughSequence: CursorSchema,
	retainedFloor: CursorSchema,
	bootstrapGeneration: Schema.Int.pipe(Schema.greaterThan(0)),
	hasMore: Schema.Boolean
});
export type PullResponse = typeof PullResponseSchema.Type;

export const SnapshotManifestEntrySchema = Schema.Struct({
	entityKind: UserSyncEntityKindSchema,
	entityId: DomainIdSchema,
	revision: Schema.NonNegativeInt,
	updatedAt: UtcInstantSchema,
	previousServerAck: Schema.Boolean
});
export type SnapshotManifestEntry = typeof SnapshotManifestEntrySchema.Type;

export const BootstrapRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: UserSyncAudienceSchema,
	manifest: Schema.Array(SnapshotManifestEntrySchema).pipe(Schema.maxItems(5_000)),
	afterEntityKey: Schema.NullOr(Schema.String),
	limit: Schema.Int.pipe(Schema.between(1, 100))
});
export type BootstrapRequest = typeof BootstrapRequestSchema.Type;

export const ReconciliationInstructionSchema = Schema.Struct({
	entityKind: UserSyncEntityKindSchema,
	entityId: DomainIdSchema,
	action: Schema.Literal('delete_acknowledged_absence', 'keep_for_backfill')
});
export type ReconciliationInstruction = typeof ReconciliationInstructionSchema.Type;

export const BootstrapResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	aggregates: Schema.Array(SyncChangeSchema),
	instructions: Schema.Array(ReconciliationInstructionSchema),
	throughSequence: CursorSchema,
	retainedFloor: CursorSchema,
	bootstrapGeneration: Schema.Int.pipe(Schema.greaterThan(0)),
	hasMore: Schema.Boolean,
	nextEntityKey: Schema.NullOr(Schema.String)
});
export type BootstrapResponse = typeof BootstrapResponseSchema.Type;

export const BackfillCheckpointSchema = Schema.Struct({
	entityKind: UserSyncEntityKindSchema,
	lastAggregateId: Schema.NullOr(DomainIdSchema),
	processedCount: Schema.NonNegativeInt
});
export type BackfillCheckpoint = typeof BackfillCheckpointSchema.Type;

export const BackfillRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: UserSyncAudienceSchema,
	checkpoint: BackfillCheckpointSchema,
	mutations: Schema.Array(SyncMutationSchema).pipe(Schema.maxItems(25))
});
export type BackfillRequest = typeof BackfillRequestSchema.Type;

export const BackfillResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	receipts: Schema.Array(MutationReceiptSchema),
	committedThrough: CursorSchema,
	checkpoint: BackfillCheckpointSchema
});
export type BackfillResponse = typeof BackfillResponseSchema.Type;

export const SyncErrorPayloadSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	error: Schema.Struct({
		_tag: Schema.Literal(
			'SyncUnauthenticated',
			'SyncIdentityMismatch',
			'SyncCapabilityDenied',
			'SyncPermissionDenied',
			'SyncBootstrapRequired',
			'SyncMalformedRequest',
			'SyncUnavailable'
		),
		code: Schema.String.pipe(Schema.minLength(1)),
		retainedFloor: Schema.optional(CursorSchema),
		bootstrapGeneration: Schema.optional(Schema.Int.pipe(Schema.greaterThan(0)))
	})
});
export type SyncErrorPayload = typeof SyncErrorPayloadSchema.Type;

interface SyncFailureFields {
	readonly code: string;
	readonly message: string;
}

export class SyncDecodeError extends Data.TaggedError('SyncDecodeError')<SyncFailureFields> {}
export class SyncTransportError extends Data.TaggedError('SyncTransportError')<
	SyncFailureFields & { readonly retryable: boolean }
> {}
export class SyncUnauthenticated extends Data.TaggedError(
	'SyncUnauthenticated'
)<SyncFailureFields> {}
export class SyncCapabilityDenied extends Data.TaggedError(
	'SyncCapabilityDenied'
)<SyncFailureFields> {}
export class SyncPermissionDenied extends Data.TaggedError(
	'SyncPermissionDenied'
)<SyncFailureFields> {}
export class SyncBootstrapRequired extends Data.TaggedError('SyncBootstrapRequired')<
	SyncFailureFields & { readonly retainedFloor: number; readonly bootstrapGeneration: number }
> {}
export class SyncLeaseLost extends Data.TaggedError('SyncLeaseLost')<SyncFailureFields> {}
