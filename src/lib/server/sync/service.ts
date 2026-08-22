import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import type {
	BackfillRequest,
	BackfillResponse,
	BootstrapRequest,
	BootstrapResponse,
	PullRequest,
	PullResponse,
	PushRequest,
	PushResponse
} from '$lib/sync/contracts.js';
import { decodeUserSyncAggregate } from '$lib/sync/user-entities.js';

import {
	ServerSyncBootstrapRequired,
	ServerSyncIdentityMismatch,
	ServerSyncMalformedRequest
} from './errors.js';
import { reconciliationInstructions, type UserSyncRepository } from './repository.js';
import { syncEntityKey } from './repository.js';

const assertUserAudience = (workosUserId: string, audience: { kind: 'user'; id: string }): void => {
	if (audience.id !== workosUserId) {
		throw new ServerSyncIdentityMismatch({
			code: 'audience_owner_mismatch',
			message: 'The requested user audience does not belong to the authenticated WorkOS subject.'
		});
	}
};

const assertMutationOwner = (
	workosUserId: string,
	mutation: PushRequest['mutations'][number]
): void => {
	try {
		decodeUserSyncAggregate(
			mutation.entityKind,
			mutation.entityId,
			workosUserId,
			mutation.aggregate
		);
	} catch {
		throw new ServerSyncMalformedRequest({
			code: 'invalid_complete_aggregate',
			message: 'A mutation does not contain an owned complete aggregate.'
		});
	}
};

export const pullUserSync = async (
	repository: UserSyncRepository,
	workosUserId: string,
	request: PullRequest
): Promise<PullResponse> => {
	assertUserAudience(workosUserId, request.audience);
	const state = await repository.readScopeState(workosUserId);
	if (request.after < state.retainedFloor) {
		throw new ServerSyncBootstrapRequired({
			code: 'cursor_expired',
			message: 'The requested cursor is older than the retained change floor.',
			retainedFloor: state.retainedFloor,
			bootstrapGeneration: state.bootstrapGeneration
		});
	}
	const page = await repository.pull(workosUserId, request.after, request.limit);
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		changes: [...page.changes],
		throughSequence: page.throughSequence,
		retainedFloor: page.retainedFloor,
		bootstrapGeneration: page.bootstrapGeneration,
		hasMore: page.hasMore
	};
};

export const pushUserSync = async (
	repository: UserSyncRepository,
	workosUserId: string,
	request: PushRequest,
	now: () => Date = () => new Date()
): Promise<PushResponse> => {
	assertUserAudience(workosUserId, request.audience);
	const receipts = [];
	for (const mutation of request.mutations) assertMutationOwner(workosUserId, mutation);
	for (const mutation of request.mutations) {
		receipts.push(
			await repository.commit({
				actorUserId: workosUserId,
				deviceId: request.deviceId,
				mutation,
				mode: 'live',
				receivedAt: now().toISOString()
			})
		);
	}
	const state = await repository.readScopeState(workosUserId);
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		receipts,
		committedThrough: state.latestSequence
	};
};

export const bootstrapUserSync = async (
	repository: UserSyncRepository,
	workosUserId: string,
	request: BootstrapRequest
): Promise<BootstrapResponse> => {
	assertUserAudience(workosUserId, request.audience);
	const snapshot = await repository.bootstrap(workosUserId);
	const ordered = [...snapshot.aggregates].toSorted((left, right) =>
		syncEntityKey(left.entityKind, left.entityId).localeCompare(
			syncEntityKey(right.entityKind, right.entityId)
		)
	);
	const remaining =
		request.afterEntityKey === null
			? ordered
			: ordered.filter(
					(change) => syncEntityKey(change.entityKind, change.entityId) > request.afterEntityKey!
				);
	const aggregates = remaining.slice(0, request.limit);
	const hasMore = remaining.length > aggregates.length;
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		aggregates,
		instructions:
			request.afterEntityKey === null
				? reconciliationInstructions(request.manifest, snapshot.authoritativeIds)
				: [],
		throughSequence: snapshot.latestSequence,
		retainedFloor: snapshot.retainedFloor,
		bootstrapGeneration: snapshot.bootstrapGeneration,
		hasMore,
		nextEntityKey: hasMore
			? syncEntityKey(aggregates.at(-1)!.entityKind, aggregates.at(-1)!.entityId)
			: null
	};
};

export const backfillUserSync = async (
	repository: UserSyncRepository,
	workosUserId: string,
	request: BackfillRequest,
	now: () => Date = () => new Date()
): Promise<BackfillResponse> => {
	assertUserAudience(workosUserId, request.audience);
	const receipts = [];
	for (const mutation of request.mutations) assertMutationOwner(workosUserId, mutation);
	for (const mutation of request.mutations) {
		receipts.push(
			await repository.commit({
				actorUserId: workosUserId,
				deviceId: request.deviceId,
				mutation,
				mode: 'backfill',
				receivedAt: now().toISOString()
			})
		);
	}
	const state = await repository.readScopeState(workosUserId);
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		receipts,
		committedThrough: state.latestSequence,
		checkpoint: {
			...request.checkpoint,
			lastAggregateId: request.mutations.at(-1)?.entityId ?? request.checkpoint.lastAggregateId,
			processedCount: request.checkpoint.processedCount + request.mutations.length
		}
	};
};
