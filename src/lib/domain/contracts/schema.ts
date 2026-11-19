import { Schema } from 'effect';

import { CURRENT_SCHEMA_VERSION } from './versions.js';

export { CURRENT_PROTOCOL_VERSION, CURRENT_SCHEMA_VERSION } from './versions.js';

/** Wraps persisted and network payloads in an explicitly versioned contract. */
export const versionedContract = <A, I, R>(payload: Schema.Schema<A, I, R>) =>
	Schema.Struct({
		schemaVersion: Schema.Literal(CURRENT_SCHEMA_VERSION),
		payload
	});

export * from './errors.js';
export * from './primitives.js';
