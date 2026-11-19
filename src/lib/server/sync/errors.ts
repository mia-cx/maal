import { Data } from 'effect';

interface ServerSyncErrorFields {
	readonly code: string;
	readonly message: string;
}

export class ServerSyncUnauthenticated extends Data.TaggedError(
	'SyncUnauthenticated'
)<ServerSyncErrorFields> {}
export class ServerSyncIdentityMismatch extends Data.TaggedError(
	'SyncIdentityMismatch'
)<ServerSyncErrorFields> {}
export class ServerSyncCapabilityDenied extends Data.TaggedError(
	'SyncCapabilityDenied'
)<ServerSyncErrorFields> {}
export class ServerSyncPermissionDenied extends Data.TaggedError(
	'SyncPermissionDenied'
)<ServerSyncErrorFields> {}
export class ServerSyncBootstrapRequired extends Data.TaggedError('SyncBootstrapRequired')<
	ServerSyncErrorFields & { readonly retainedFloor: number; readonly bootstrapGeneration: number }
> {}
export class ServerSyncMalformedRequest extends Data.TaggedError(
	'SyncMalformedRequest'
)<ServerSyncErrorFields> {}
export class ServerSyncUnavailable extends Data.TaggedError(
	'SyncUnavailable'
)<ServerSyncErrorFields> {}
