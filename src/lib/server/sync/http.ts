import { json, type RequestEvent } from '@sveltejs/kit';
import { Schema } from 'effect';

import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import {
	BackfillRequestSchema,
	BootstrapRequestSchema,
	PullRequestSchema,
	PushRequestSchema
} from '$lib/sync/contracts.js';
import {
	HouseholdBackfillRequestSchema,
	HouseholdBootstrapRequestSchema,
	HouseholdPullRequestSchema,
	HouseholdPushRequestSchema,
	type HouseholdSyncEntityKind
} from '$lib/sync/household-contracts.js';

import { authenticateSyncSlot } from './auth.js';
import {
	d1HouseholdSyncCapabilityAuthorizer,
	d1UserSyncCapabilityAuthorizer,
	type HouseholdSyncPermission,
	type UserSyncPermission
} from './capability.js';
import { D1UserSyncRepository } from './d1-repository.js';
import { ServerSyncMalformedRequest, ServerSyncUnavailable } from './errors.js';
import { D1HouseholdSyncRepository } from './household-d1-repository.js';
import {
	backfillHouseholdSync,
	bootstrapHouseholdSync,
	pullHouseholdSync,
	pushHouseholdSync
} from './household-service.js';
import { backfillUserSync, bootstrapUserSync, pullUserSync, pushUserSync } from './service.js';

type SyncOperation = 'pull' | 'push' | 'bootstrap' | 'backfill';
const MAX_SYNC_BODY_BYTES = 1024 * 1024;

const schemaFor = {
	pull: PullRequestSchema,
	push: PushRequestSchema,
	bootstrap: BootstrapRequestSchema,
	backfill: BackfillRequestSchema
} as const;

const permissionFor = (operation: SyncOperation): UserSyncPermission =>
	operation === 'pull' || operation === 'bootstrap' ? 'recipes:read' : 'recipes:write';

const householdPermissionsFor = (
	operation: SyncOperation,
	entityKinds: readonly HouseholdSyncEntityKind[]
): readonly HouseholdSyncPermission[] => {
	if (operation === 'pull' || operation === 'bootstrap') return ['meals:read'];
	const permissions = new Set<HouseholdSyncPermission>();
	for (const entityKind of entityKinds) {
		permissions.add(
			entityKind === 'meal' || entityKind === 'meal_check_in' ? 'meals:write' : 'households:write'
		);
	}
	return [...permissions];
};

const readBody = async (request: Request): Promise<unknown> => {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_SYNC_BODY_BYTES) {
		throw new ServerSyncMalformedRequest({
			code: 'body_too_large',
			message: 'The sync request exceeds the bounded protocol payload.'
		});
	}
	if (!request.body) {
		throw new ServerSyncMalformedRequest({
			code: 'malformed_json',
			message: 'The sync request has no JSON body.'
		});
	}
	try {
		const reader = request.body.getReader();
		const chunks: Uint8Array[] = [];
		let received = 0;
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += chunk.value.byteLength;
			if (received > MAX_SYNC_BODY_BYTES) {
				await reader.cancel();
				throw new ServerSyncMalformedRequest({
					code: 'body_too_large',
					message: 'The sync request exceeds the bounded protocol payload.'
				});
			}
			chunks.push(chunk.value);
		}
		const bytes = new Uint8Array(received);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch (error) {
		// Preserve the safe tagged size failure while normalizing native stream/JSON errors.
		if (
			typeof error === 'object' &&
			error !== null &&
			'_tag' in error &&
			error._tag === 'SyncMalformedRequest'
		) {
			throw error;
		}
		throw new ServerSyncMalformedRequest({
			code: 'malformed_json',
			message: 'The sync request is not valid JSON.'
		});
	}
};

const decodeRequest = <A>(schema: Schema.Schema<A>, input: unknown): A => {
	try {
		return Schema.decodeUnknownSync(schema)(input);
	} catch {
		throw new ServerSyncMalformedRequest({
			code: 'contract_mismatch',
			message: 'The sync request does not match the current protocol contract.'
		});
	}
};

const statusFor = (tag: string): number =>
	tag === 'SyncUnauthenticated'
		? 401
		: tag === 'SyncIdentityMismatch' ||
			  tag === 'SyncCapabilityDenied' ||
			  tag === 'SyncPermissionDenied'
			? 403
			: tag === 'SyncBootstrapRequired'
				? 409
				: tag === 'SyncMalformedRequest'
					? 400
					: 503;

export const syncErrorResponse = (error: unknown): Response => {
	const tagged = typeof error === 'object' && error !== null && '_tag' in error;
	const suppliedTag = tagged && typeof error._tag === 'string' ? error._tag : 'SyncUnavailable';
	const publicTags = new Set([
		'SyncUnauthenticated',
		'SyncIdentityMismatch',
		'SyncCapabilityDenied',
		'SyncPermissionDenied',
		'SyncBootstrapRequired',
		'SyncMalformedRequest',
		'SyncUnavailable'
	]);
	const tag = publicTags.has(suppliedTag) ? suppliedTag : 'SyncUnavailable';
	const code =
		tagged && 'code' in error && typeof error.code === 'string' ? error.code : 'sync_unavailable';
	const retainedFloor =
		tagged && 'retainedFloor' in error && typeof error.retainedFloor === 'number'
			? error.retainedFloor
			: undefined;
	const bootstrapGeneration =
		tagged && 'bootstrapGeneration' in error && typeof error.bootstrapGeneration === 'number'
			? error.bootstrapGeneration
			: undefined;
	return json(
		{
			protocolVersion: CURRENT_PROTOCOL_VERSION,
			error: {
				_tag: tag,
				code,
				...(retainedFloor === undefined ? {} : { retainedFloor }),
				...(bootstrapGeneration === undefined ? {} : { bootstrapGeneration })
			}
		},
		{ status: statusFor(tag) }
	);
};

export const handleUserSyncRequest = async (
	event: Pick<RequestEvent, 'cookies' | 'params' | 'platform' | 'request'>,
	operation: SyncOperation
): Promise<Response> => {
	try {
		const slot = await authenticateSyncSlot(event);
		const database = event.platform?.env.DB;
		if (!database) {
			throw new ServerSyncUnavailable({ code: 'd1_unavailable', message: 'D1 is unavailable.' });
		}
		const body = await readBody(event.request);
		const audience =
			typeof body === 'object' && body !== null && 'audience' in body
				? (body as { audience?: unknown }).audience
				: null;
		const audienceKind =
			typeof audience === 'object' && audience !== null && 'kind' in audience
				? (audience as { kind?: unknown }).kind
				: null;
		if (audienceKind === 'household') {
			const decoded =
				operation === 'pull'
					? decodeRequest(HouseholdPullRequestSchema, body)
					: operation === 'push'
						? decodeRequest(HouseholdPushRequestSchema, body)
						: operation === 'bootstrap'
							? decodeRequest(HouseholdBootstrapRequestSchema, body)
							: decodeRequest(HouseholdBackfillRequestSchema, body);
			const entityKinds =
				'mutations' in decoded ? decoded.mutations.map(({ entityKind }) => entityKind) : [];
			for (const permission of householdPermissionsFor(operation, entityKinds)) {
				await d1HouseholdSyncCapabilityAuthorizer.authorize({
					database,
					workosUserId: slot.workosUserId,
					householdId: decoded.audience.id,
					activeWorkOSMemberships: slot.activeMemberships,
					permission,
					now: new Date().toISOString()
				});
			}
			const repository = new D1HouseholdSyncRepository(database);
			switch (operation) {
				case 'pull': {
					const request = decodeRequest(HouseholdPullRequestSchema, body);
					return json(await pullHouseholdSync(repository, request.audience.id, request));
				}
				case 'push': {
					const request = decodeRequest(HouseholdPushRequestSchema, body);
					return json(
						await pushHouseholdSync(repository, request.audience.id, slot.workosUserId, request)
					);
				}
				case 'bootstrap': {
					const request = decodeRequest(HouseholdBootstrapRequestSchema, body);
					return json(await bootstrapHouseholdSync(repository, request.audience.id, request));
				}
				case 'backfill': {
					const request = decodeRequest(HouseholdBackfillRequestSchema, body);
					return json(
						await backfillHouseholdSync(repository, request.audience.id, slot.workosUserId, request)
					);
				}
			}
		}
		if (audienceKind !== 'user') {
			throw new ServerSyncMalformedRequest({
				code: 'audience_kind_invalid',
				message: 'The sync audience kind is unsupported.'
			});
		}
		await d1UserSyncCapabilityAuthorizer.authorize({
			database,
			workosUserId: slot.workosUserId,
			activeWorkOSMemberships: slot.activeMemberships,
			permission: permissionFor(operation),
			now: new Date().toISOString()
		});
		const repository = new D1UserSyncRepository(database);
		switch (operation) {
			case 'pull':
				return json(
					await pullUserSync(repository, slot.workosUserId, decodeRequest(schemaFor.pull, body))
				);
			case 'push':
				return json(
					await pushUserSync(repository, slot.workosUserId, decodeRequest(schemaFor.push, body))
				);
			case 'bootstrap':
				return json(
					await bootstrapUserSync(
						repository,
						slot.workosUserId,
						decodeRequest(schemaFor.bootstrap, body)
					)
				);
			case 'backfill':
				return json(
					await backfillUserSync(
						repository,
						slot.workosUserId,
						decodeRequest(schemaFor.backfill, body)
					)
				);
		}
	} catch (error) {
		return syncErrorResponse(error);
	}
};
