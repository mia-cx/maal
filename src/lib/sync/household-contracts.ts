import { Schema } from 'effect';

import { DomainIdSchema, UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import {
	CURRENT_PROTOCOL_VERSION,
	CURRENT_SCHEMA_VERSION
} from '$lib/domain/contracts/versions.js';

import { MutationReceiptSchema } from './contracts.js';

export const HOUSEHOLD_SYNC_ENTITY_KINDS = [
	'household',
	'meal',
	'meal_check_in',
	'householdAppliance',
	'foodHouseholdAlias',
	'foodHouseholdEntry',
	'unitHouseholdAlias',
	'unitHouseholdEntry',
	'householdFoodDisplayPreference',
	'householdUnitDisplayPreference'
] as const;

export const HouseholdSyncEntityKindSchema = Schema.Literal(...HOUSEHOLD_SYNC_ENTITY_KINDS);
export type HouseholdSyncEntityKind = typeof HouseholdSyncEntityKindSchema.Type;

export const HouseholdSyncAudienceSchema = Schema.Struct({
	kind: Schema.Literal('household'),
	id: Schema.String.pipe(Schema.minLength(1))
});
export type HouseholdSyncAudience = typeof HouseholdSyncAudienceSchema.Type;

const CursorSchema = Schema.NonNegativeInt;
const NullableCursorSchema = Schema.NullOr(CursorSchema);
const ProtocolVersionSchema = Schema.Literal(CURRENT_PROTOCOL_VERSION);
const HouseholdEntityIdSchema = Schema.String.pipe(Schema.minLength(1));

export const HouseholdSyncMutationSchema = Schema.Struct({
	schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
	mutationId: DomainIdSchema,
	originDeviceId: DomainIdSchema,
	entityKind: HouseholdSyncEntityKindSchema,
	entityId: HouseholdEntityIdSchema,
	conflictGroups: Schema.NonEmptyArray(Schema.String.pipe(Schema.minLength(1))),
	operation: Schema.Literal('upsert', 'delete'),
	occurredAt: UtcInstantSchema,
	aggregate: Schema.Unknown
});
export type HouseholdSyncMutation = typeof HouseholdSyncMutationSchema.Type;

export const HouseholdPushRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: HouseholdSyncAudienceSchema,
	baseCursor: NullableCursorSchema,
	mutations: Schema.Array(HouseholdSyncMutationSchema).pipe(Schema.maxItems(50))
});
export type HouseholdPushRequest = typeof HouseholdPushRequestSchema.Type;

export const HouseholdPushResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	receipts: Schema.Array(MutationReceiptSchema),
	committedThrough: CursorSchema
});
export type HouseholdPushResponse = typeof HouseholdPushResponseSchema.Type;

export const HouseholdPullRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: HouseholdSyncAudienceSchema,
	after: CursorSchema,
	limit: Schema.Int.pipe(Schema.between(1, 100))
});
export type HouseholdPullRequest = typeof HouseholdPullRequestSchema.Type;

export const HouseholdSyncChangeSchema = Schema.Struct({
	sequence: CursorSchema,
	mutationId: DomainIdSchema,
	originDeviceId: DomainIdSchema,
	actorUserId: Schema.String.pipe(Schema.minLength(1)),
	entityKind: HouseholdSyncEntityKindSchema,
	entityId: HouseholdEntityIdSchema,
	conflictGroups: Schema.NonEmptyArray(Schema.String.pipe(Schema.minLength(1))),
	operation: Schema.Literal('upsert', 'delete'),
	resultingRevision: Schema.NonNegativeInt,
	occurredAt: UtcInstantSchema,
	receivedAt: UtcInstantSchema,
	aggregate: Schema.Unknown,
	tombstoneExpiresAt: Schema.NullOr(UtcInstantSchema)
});
export type HouseholdSyncChange = typeof HouseholdSyncChangeSchema.Type;

export const HouseholdPullResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	changes: Schema.Array(HouseholdSyncChangeSchema),
	throughSequence: CursorSchema,
	retainedFloor: CursorSchema,
	bootstrapGeneration: Schema.Int.pipe(Schema.greaterThan(0)),
	hasMore: Schema.Boolean
});
export type HouseholdPullResponse = typeof HouseholdPullResponseSchema.Type;

export const HouseholdSnapshotManifestEntrySchema = Schema.Struct({
	entityKind: HouseholdSyncEntityKindSchema,
	entityId: HouseholdEntityIdSchema,
	revision: Schema.NonNegativeInt,
	updatedAt: UtcInstantSchema,
	previousServerAck: Schema.Boolean
});
export type HouseholdSnapshotManifestEntry = typeof HouseholdSnapshotManifestEntrySchema.Type;

export const HouseholdBootstrapRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: HouseholdSyncAudienceSchema,
	manifest: Schema.Array(HouseholdSnapshotManifestEntrySchema).pipe(Schema.maxItems(5_000)),
	afterEntityKey: Schema.NullOr(Schema.String),
	limit: Schema.Int.pipe(Schema.between(1, 100))
});
export type HouseholdBootstrapRequest = typeof HouseholdBootstrapRequestSchema.Type;

export const HouseholdReconciliationInstructionSchema = Schema.Struct({
	entityKind: HouseholdSyncEntityKindSchema,
	entityId: HouseholdEntityIdSchema,
	action: Schema.Literal('delete_acknowledged_absence', 'keep_for_backfill')
});
export type HouseholdReconciliationInstruction =
	typeof HouseholdReconciliationInstructionSchema.Type;

export const HouseholdBootstrapResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	aggregates: Schema.Array(HouseholdSyncChangeSchema),
	instructions: Schema.Array(HouseholdReconciliationInstructionSchema),
	throughSequence: CursorSchema,
	retainedFloor: CursorSchema,
	bootstrapGeneration: Schema.Int.pipe(Schema.greaterThan(0)),
	hasMore: Schema.Boolean,
	nextEntityKey: Schema.NullOr(Schema.String)
});
export type HouseholdBootstrapResponse = typeof HouseholdBootstrapResponseSchema.Type;

export const HouseholdBackfillCheckpointSchema = Schema.Struct({
	entityKind: HouseholdSyncEntityKindSchema,
	lastAggregateId: Schema.NullOr(HouseholdEntityIdSchema),
	processedCount: Schema.NonNegativeInt,
	priorityBoundary: Schema.NullOr(Schema.String)
});
export type HouseholdBackfillCheckpoint = typeof HouseholdBackfillCheckpointSchema.Type;

export const HouseholdBackfillRequestSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	deviceId: DomainIdSchema,
	audience: HouseholdSyncAudienceSchema,
	checkpoint: HouseholdBackfillCheckpointSchema,
	mutations: Schema.Array(HouseholdSyncMutationSchema).pipe(Schema.maxItems(25))
});
export type HouseholdBackfillRequest = typeof HouseholdBackfillRequestSchema.Type;

export const HouseholdBackfillResponseSchema = Schema.Struct({
	protocolVersion: ProtocolVersionSchema,
	receipts: Schema.Array(MutationReceiptSchema),
	committedThrough: CursorSchema,
	checkpoint: HouseholdBackfillCheckpointSchema
});
export type HouseholdBackfillResponse = typeof HouseholdBackfillResponseSchema.Type;
