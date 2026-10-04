import { Schema } from 'effect';

import { CURRENT_SCHEMA_VERSION } from './versions.js';

export const DomainIdSchema = Schema.String.pipe(
	Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
);
export type DomainId = typeof DomainIdSchema.Type;

export const UtcInstantSchema = Schema.String.pipe(
	Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
	Schema.filter((value) => !Number.isNaN(Date.parse(value)))
);
export type UtcInstant = typeof UtcInstantSchema.Type;

export const LocalDateSchema = Schema.String.pipe(
	Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
	Schema.filter((value) => {
		const [year, month, day] = value.split('-').map(Number);
		const date = new Date(Date.UTC(year, month - 1, day));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		);
	})
);
export type LocalDate = typeof LocalDateSchema.Type;

export const LocalTimeSchema = Schema.String.pipe(
	Schema.pattern(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
);
export type LocalTime = typeof LocalTimeSchema.Type;

export const LocaleSchema = Schema.String.pipe(
	Schema.pattern(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
);
export type Locale = typeof LocaleSchema.Type;

export const TimeZoneSchema = Schema.String.pipe(
	Schema.filter((value) => {
		try {
			Intl.DateTimeFormat('en', { timeZone: value });
			return true;
		} catch {
			return false;
		}
	})
);
export type TimeZone = typeof TimeZoneSchema.Type;

export const ConfidenceSchema = Schema.Number.pipe(
	Schema.greaterThanOrEqualTo(0),
	Schema.lessThanOrEqualTo(1)
);
export type Confidence = typeof ConfidenceSchema.Type;

export const PositionSchema = Schema.NonNegativeInt;
export type Position = typeof PositionSchema.Type;

export const isOptionalPair = (left: unknown, right: unknown): boolean =>
	(left === null && right === null) || (left !== null && right !== null);

export const ConflictClockSchema = Schema.Struct({
	occurredAt: UtcInstantSchema,
	originDeviceId: DomainIdSchema,
	mutationId: DomainIdSchema
});
export type ConflictClock = typeof ConflictClockSchema.Type;

export const ConflictClocksSchema = Schema.Record({
	key: Schema.String,
	value: ConflictClockSchema
});
export type ConflictClocks = typeof ConflictClocksSchema.Type;

export const MutableAggregateFields = {
	schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
	revision: Schema.NonNegativeInt,
	createdAt: UtcInstantSchema,
	updatedAt: UtcInstantSchema,
	deletedAt: Schema.NullOr(UtcInstantSchema),
	conflictClocks: ConflictClocksSchema
} as const;

export const MutableAggregateSchema = Schema.Struct(MutableAggregateFields);
export type MutableAggregate = typeof MutableAggregateSchema.Type;

export const ScopeKindSchema = Schema.Literal('user', 'household');
export type ScopeKind = typeof ScopeKindSchema.Type;

export const LocalMutationOperationSchema = Schema.Literal('upsert', 'delete');
export type LocalMutationOperation = typeof LocalMutationOperationSchema.Type;

export const OutboxMutationSchema = Schema.Struct({
	schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
	mutationId: DomainIdSchema,
	authSlotId: Schema.String,
	scopeKind: ScopeKindSchema,
	scopeId: Schema.String,
	entityKind: Schema.String,
	aggregateId: Schema.String,
	conflictGroup: Schema.String,
	operation: LocalMutationOperationSchema,
	occurredAt: UtcInstantSchema,
	originDeviceId: DomainIdSchema,
	payload: Schema.Unknown
});
export type OutboxMutation = typeof OutboxMutationSchema.Type;
