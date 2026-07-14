import { Schema } from 'effect';

export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Wraps persisted and network payloads in an explicitly versioned contract. */
export const versionedContract = <A, I, R>(payload: Schema.Schema<A, I, R>) =>
	Schema.Struct({
		schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
		payload
	});
