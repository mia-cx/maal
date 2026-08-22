import { Schema } from 'effect';

import {
	BackfillRequestSchema,
	BackfillResponseSchema,
	BootstrapRequestSchema,
	BootstrapResponseSchema,
	PullRequestSchema,
	PullResponseSchema,
	PushRequestSchema,
	PushResponseSchema,
	SyncBootstrapRequired,
	SyncCapabilityDenied,
	SyncDecodeError,
	SyncErrorPayloadSchema,
	SyncPermissionDenied,
	SyncTransportError,
	SyncUnauthenticated,
	type BackfillRequest,
	type BackfillResponse,
	type BootstrapRequest,
	type BootstrapResponse,
	type PullRequest,
	type PullResponse,
	type PushRequest,
	type PushResponse
} from '$lib/sync/contracts.js';

export interface UserSyncTransport {
	pull(authSlotId: string, request: PullRequest): Promise<PullResponse>;
	push(authSlotId: string, request: PushRequest): Promise<PushResponse>;
	bootstrap(authSlotId: string, request: BootstrapRequest): Promise<BootstrapResponse>;
	backfill(authSlotId: string, request: BackfillRequest): Promise<BackfillResponse>;
}

export interface FetchUserSyncTransportOptions {
	readonly fetch?: typeof globalThis.fetch;
	readonly basePath?: string;
}

const decode = <A>(schema: Schema.Schema<A>, input: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(input);
	} catch {
		throw new SyncDecodeError({
			code: 'malformed_response',
			message: `${operation} was malformed.`
		});
	}
};

const throwRemoteError = (status: number, input: unknown): never => {
	const payload = decode(SyncErrorPayloadSchema, input, 'sync error response');
	const fields = { code: payload.error.code, message: 'The sync request was rejected.' };
	switch (payload.error._tag) {
		case 'SyncUnauthenticated':
			throw new SyncUnauthenticated(fields);
		case 'SyncCapabilityDenied':
			throw new SyncCapabilityDenied(fields);
		case 'SyncPermissionDenied':
		case 'SyncIdentityMismatch':
			throw new SyncPermissionDenied(fields);
		case 'SyncBootstrapRequired':
			throw new SyncBootstrapRequired({
				...fields,
				retainedFloor: payload.error.retainedFloor ?? 0,
				bootstrapGeneration: payload.error.bootstrapGeneration ?? 1
			});
		default:
			throw new SyncTransportError({
				...fields,
				retryable: status >= 500 || status === 429
			});
	}
};

export const createFetchUserSyncTransport = (
	options: FetchUserSyncTransportOptions = {}
): UserSyncTransport => {
	const performFetch = options.fetch ?? globalThis.fetch;
	const basePath = options.basePath ?? '/api/auth-slots';

	const request = async <A, I>(
		authSlotId: string,
		operation: 'pull' | 'push' | 'bootstrap' | 'backfill',
		requestSchema: Schema.Schema<I>,
		responseSchema: Schema.Schema<A>,
		body: unknown
	): Promise<A> => {
		const decodedBody = decode(requestSchema, body, `${operation} request`);
		let response: Response;
		try {
			response = await performFetch(
				`${basePath}/${encodeURIComponent(authSlotId)}/sync/${operation}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(decodedBody)
				}
			);
		} catch {
			throw new SyncTransportError({
				code: 'network_unavailable',
				message: 'The sync service is unreachable.',
				retryable: true
			});
		}
		const payload: unknown = await response.json().catch(() => null);
		if (!response.ok) throwRemoteError(response.status, payload);
		return decode(responseSchema, payload, `${operation} response`);
	};

	return {
		pull: (authSlotId, body) =>
			request(authSlotId, 'pull', PullRequestSchema, PullResponseSchema, body),
		push: (authSlotId, body) =>
			request(authSlotId, 'push', PushRequestSchema, PushResponseSchema, body),
		bootstrap: (authSlotId, body) =>
			request(authSlotId, 'bootstrap', BootstrapRequestSchema, BootstrapResponseSchema, body),
		backfill: (authSlotId, body) =>
			request(authSlotId, 'backfill', BackfillRequestSchema, BackfillResponseSchema, body)
	};
};
