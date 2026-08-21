import { Effect, Schema } from 'effect';
import { versionedContract } from '$lib/domain/contracts/schema.js';
import { maalApiScopeValues } from './schema/enums.js';

export class D1RowDecodeError extends Schema.TaggedError<D1RowDecodeError>('D1RowDecodeError')(
	'D1RowDecodeError',
	{
		table: Schema.String,
		column: Schema.String,
		reason: Schema.String
	}
) {}

export class D1RowEncodeError extends Schema.TaggedError<D1RowEncodeError>('D1RowEncodeError')(
	'D1RowEncodeError',
	{
		table: Schema.String,
		column: Schema.String,
		reason: Schema.String
	}
) {}

export class D1WriteError extends Schema.TaggedError<D1WriteError>('D1WriteError')('D1WriteError', {
	table: Schema.String,
	operation: Schema.Literal('insert', 'update', 'delete'),
	code: Schema.Literal('unique', 'foreign_key', 'check', 'not_null', 'unknown')
}) {}

export const EncodedPermissionsSchema = Schema.parseJson(Schema.Array(Schema.String));
export const EncodedMcpScopesSchema = Schema.parseJson(
	Schema.Array(Schema.Literal(...maalApiScopeValues))
);
export const EncodedSyncPayloadSchema = Schema.parseJson(versionedContract(Schema.Unknown));

const decodeFailureReason = 'Persisted value does not match the current Effect contract';
const encodeFailureReason = 'Domain value cannot be represented by the D1 row contract';

export const decodeJsonColumn =
	<A, I>(table: string, column: string, schema: Schema.Schema<A, I>) =>
	(value: unknown): Effect.Effect<A, D1RowDecodeError> =>
		Schema.decodeUnknown(schema)(value).pipe(
			Effect.mapError(() => new D1RowDecodeError({ table, column, reason: decodeFailureReason }))
		);

export const encodeJsonColumn =
	<A, I>(table: string, column: string, schema: Schema.Schema<A, I>) =>
	(value: A): Effect.Effect<I, D1RowEncodeError> =>
		Schema.encode(schema)(value).pipe(
			Effect.mapError(() => new D1RowEncodeError({ table, column, reason: encodeFailureReason }))
		);

export const decodeMembershipPermissions = decodeJsonColumn(
	'household_memberships',
	'permissions',
	EncodedPermissionsSchema
);
export const encodeMembershipPermissions = encodeJsonColumn(
	'household_memberships',
	'permissions',
	EncodedPermissionsSchema
);
export const decodeMcpScopes = decodeJsonColumn('mcp_keys', 'scopes', EncodedMcpScopesSchema);
export const encodeMcpScopes = encodeJsonColumn('mcp_keys', 'scopes', EncodedMcpScopesSchema);
export const decodeSyncPayload = decodeJsonColumn(
	'sync_changes',
	'payload',
	EncodedSyncPayloadSchema
);
export const encodeSyncPayload = encodeJsonColumn(
	'sync_changes',
	'payload',
	EncodedSyncPayloadSchema
);

export const toD1WriteError = (
	table: string,
	operation: 'insert' | 'update' | 'delete',
	error: unknown
): D1WriteError => {
	const message = error instanceof Error ? error.message : '';
	const code = message.includes('UNIQUE constraint failed')
		? 'unique'
		: message.includes('FOREIGN KEY constraint failed')
			? 'foreign_key'
			: message.includes('CHECK constraint failed')
				? 'check'
				: message.includes('NOT NULL constraint failed')
					? 'not_null'
					: 'unknown';
	return new D1WriteError({ table, operation, code });
};
