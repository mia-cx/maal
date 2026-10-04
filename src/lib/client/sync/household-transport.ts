import { Schema } from 'effect';

import {
	SyncBootstrapRequired,
	SyncCapabilityDenied,
	SyncDecodeError,
	SyncErrorPayloadSchema,
	SyncPermissionDenied,
	SyncTransportError,
	SyncUnauthenticated
} from '$lib/sync/contracts.js';
import {
	HouseholdBackfillRequestSchema,
	HouseholdBackfillResponseSchema,
	HouseholdBootstrapRequestSchema,
	HouseholdBootstrapResponseSchema,
	HouseholdPullRequestSchema,
	HouseholdPullResponseSchema,
	HouseholdPushRequestSchema,
	HouseholdPushResponseSchema,
	type HouseholdBackfillRequest,
	type HouseholdBackfillResponse,
	type HouseholdBootstrapRequest,
	type HouseholdBootstrapResponse,
	type HouseholdPullRequest,
	type HouseholdPullResponse,
	type HouseholdPushRequest,
	type HouseholdPushResponse
} from '$lib/sync/household-contracts.js';

export interface HouseholdSyncTransport {
	pull(authSlotId: string, request: HouseholdPullRequest): Promise<HouseholdPullResponse>;
	push(authSlotId: string, request: HouseholdPushRequest): Promise<HouseholdPushResponse>;
	bootstrap(
		authSlotId: string,
		request: HouseholdBootstrapRequest
	): Promise<HouseholdBootstrapResponse>;
	backfill(
		authSlotId: string,
		request: HouseholdBackfillRequest
	): Promise<HouseholdBackfillResponse>;
}

export interface FetchHouseholdSyncTransportOptions {
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
			throw new SyncTransportError({ ...fields, retryable: status >= 500 || status === 429 });
	}
};

export const createFetchHouseholdSyncTransport = (
	options: FetchHouseholdSyncTransportOptions = {}
): HouseholdSyncTransport => {
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
		pull: (slot, body) =>
			request(slot, 'pull', HouseholdPullRequestSchema, HouseholdPullResponseSchema, body),
		push: (slot, body) =>
			request(slot, 'push', HouseholdPushRequestSchema, HouseholdPushResponseSchema, body),
		bootstrap: (slot, body) =>
			request(
				slot,
				'bootstrap',
				HouseholdBootstrapRequestSchema,
				HouseholdBootstrapResponseSchema,
				body
			),
		backfill: (slot, body) =>
			request(
				slot,
				'backfill',
				HouseholdBackfillRequestSchema,
				HouseholdBackfillResponseSchema,
				body
			)
	};
};
