import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import type { MutationReceipt } from '$lib/sync/contracts.js';
import type {
	HouseholdBackfillRequest,
	HouseholdBackfillResponse,
	HouseholdBootstrapRequest,
	HouseholdBootstrapResponse,
	HouseholdPullRequest,
	HouseholdPullResponse,
	HouseholdPushRequest,
	HouseholdPushResponse,
	HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';
import {
	assertHouseholdMutationActor,
	decodeHouseholdSyncAggregate
} from '$lib/sync/household-entities.js';

import { ServerSyncBootstrapRequired, ServerSyncMalformedRequest } from './errors.js';
import {
	householdReconciliationInstructions,
	householdSyncEntityKey,
	type HouseholdSyncRepository
} from './household-repository.js';

const assertMutation = (
	householdId: string,
	actorUserId: string,
	mutation: HouseholdSyncMutation
): void => {
	try {
		const decoded = decodeHouseholdSyncAggregate(
			mutation.entityKind,
			mutation.entityId,
			householdId,
			mutation.aggregate
		);
		assertHouseholdMutationActor(mutation.entityKind, actorUserId, decoded.aggregate);
	} catch {
		throw new ServerSyncMalformedRequest({
			code: 'invalid_household_aggregate',
			message: 'A mutation is outside its household or actor boundary.'
		});
	}
};

export const pullHouseholdSync = async (
	repository: HouseholdSyncRepository,
	householdId: string,
	request: HouseholdPullRequest
): Promise<HouseholdPullResponse> => {
	const state = await repository.readScopeState(householdId);
	if (request.after < state.retainedFloor) {
		throw new ServerSyncBootstrapRequired({
			code: 'cursor_expired',
			message: 'The requested cursor is older than the retained change floor.',
			retainedFloor: state.retainedFloor,
			bootstrapGeneration: state.bootstrapGeneration
		});
	}
	const page = await repository.pull(householdId, request.after, request.limit);
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		changes: [...page.changes],
		throughSequence: page.throughSequence,
		retainedFloor: page.retainedFloor,
		bootstrapGeneration: page.bootstrapGeneration,
		hasMore: page.hasMore
	};
};

export const pushHouseholdSync = async (
	repository: HouseholdSyncRepository,
	householdId: string,
	actorUserId: string,
	request: HouseholdPushRequest,
	now: () => Date = () => new Date()
): Promise<HouseholdPushResponse> => {
	const receipts: MutationReceipt[] = [];
	for (const mutation of request.mutations) {
		assertMutation(householdId, actorUserId, mutation);
		receipts.push(
			await repository.commit({
				householdId,
				actorUserId,
				deviceId: request.deviceId,
				mutation,
				mode: 'live',
				receivedAt: now().toISOString()
			})
		);
	}
	const state = await repository.readScopeState(householdId);
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		receipts,
		committedThrough: state.latestSequence
	};
};

export const bootstrapHouseholdSync = async (
	repository: HouseholdSyncRepository,
	householdId: string,
	request: HouseholdBootstrapRequest
): Promise<HouseholdBootstrapResponse> => {
	const snapshot = await repository.bootstrap(householdId);
	const ordered = [...snapshot.aggregates].toSorted((left, right) =>
		householdSyncEntityKey(left.entityKind, left.entityId).localeCompare(
			householdSyncEntityKey(right.entityKind, right.entityId)
		)
	);
	const remaining =
		request.afterEntityKey === null
			? ordered
			: ordered.filter(
					(change) =>
						householdSyncEntityKey(change.entityKind, change.entityId) > request.afterEntityKey!
				);
	const aggregates = remaining.slice(0, request.limit);
	const hasMore = remaining.length > aggregates.length;
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		aggregates,
		instructions:
			request.afterEntityKey === null
				? householdReconciliationInstructions(request.manifest, snapshot.authoritativeIds)
				: [],
		throughSequence: snapshot.latestSequence,
		retainedFloor: snapshot.retainedFloor,
		bootstrapGeneration: snapshot.bootstrapGeneration,
		hasMore,
		nextEntityKey: hasMore
			? householdSyncEntityKey(aggregates.at(-1)!.entityKind, aggregates.at(-1)!.entityId)
			: null
	};
};

export const backfillHouseholdSync = async (
	repository: HouseholdSyncRepository,
	householdId: string,
	actorUserId: string,
	request: HouseholdBackfillRequest,
	now: () => Date = () => new Date()
): Promise<HouseholdBackfillResponse> => {
	const receipts: MutationReceipt[] = [];
	for (const mutation of request.mutations) {
		assertMutation(householdId, actorUserId, mutation);
		receipts.push(
			await repository.commit({
				householdId,
				actorUserId,
				deviceId: request.deviceId,
				mutation,
				mode: 'backfill',
				receivedAt: now().toISOString()
			})
		);
	}
	const state = await repository.readScopeState(householdId);
	const lastMutation = request.mutations.at(-1);
	return {
		protocolVersion: CURRENT_PROTOCOL_VERSION,
		receipts,
		committedThrough: state.latestSequence,
		checkpoint: {
			...request.checkpoint,
			lastAggregateId: lastMutation?.entityId ?? request.checkpoint.lastAggregateId,
			processedCount: request.checkpoint.processedCount + request.mutations.length
		}
	};
};
