import { json, type RequestEvent } from '@sveltejs/kit';
import { Schema } from 'effect';

import {
	CreateRemoteHouseholdInviteRequestSchema,
	CreateRemoteHouseholdRequestSchema,
	JoinRemoteHouseholdRequestSchema,
	UpdateRemoteHouseholdMemberRoleRequestSchema,
	type HouseholdAdministrationErrorCode
} from '$lib/domain/household/administration.js';
import { authenticateSyncSlot } from '$lib/server/sync/auth.js';

import { HouseholdAdministrationError } from './errors.js';
import { createWorkOSHouseholdIdentityAdapter, type HouseholdIdentityAdapter } from './identity.js';
import { HouseholdAdministrationRepository } from './repository.js';
import { HouseholdAdministrationService, type HouseholdAdministrationActor } from './service.js';

export type HouseholdAdministrationOperation =
	| 'createHousehold'
	| 'joinHousehold'
	| 'refreshHousehold'
	| 'createInvite'
	| 'revokeInvite'
	| 'updateMemberRole'
	| 'removeMember'
	| 'leaveHousehold';

export interface HouseholdAdministrationHttpDependencies {
	readonly authenticate?: (event: RequestEvent) => Promise<HouseholdAdministrationActor>;
	readonly identity?: HouseholdIdentityAdapter;
	readonly now?: () => string;
}

const MAX_BODY_BYTES = 64 * 1024;

const readBody = async (request: Request): Promise<unknown> => {
	const contentLength = Number(request.headers.get('content-length') ?? 0);
	if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
		throw new HouseholdAdministrationError({ code: 'malformed_request' });
	}
	if (!request.body) throw new HouseholdAdministrationError({ code: 'malformed_request' });
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			received += chunk.value.byteLength;
			if (received > MAX_BODY_BYTES) {
				await reader.cancel();
				throw new HouseholdAdministrationError({ code: 'malformed_request' });
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
	} catch (cause) {
		if (cause instanceof HouseholdAdministrationError) throw cause;
		throw new HouseholdAdministrationError({ code: 'malformed_request', cause });
	}
};

const decode = <A>(schema: Schema.Schema<A>, input: unknown): A => {
	try {
		return Schema.decodeUnknownSync(schema)(input);
	} catch (cause) {
		throw new HouseholdAdministrationError({ code: 'malformed_request', cause });
	}
};

const requiredParam = (event: RequestEvent, key: string): string => {
	const value = event.params[key]?.trim();
	if (!value) throw new HouseholdAdministrationError({ code: 'malformed_request' });
	return value;
};

const defaultAuthenticate = async (event: RequestEvent): Promise<HouseholdAdministrationActor> => {
	try {
		return await authenticateSyncSlot(event);
	} catch (cause) {
		const tagged = typeof cause === 'object' && cause !== null && '_tag' in cause;
		if (!tagged || cause._tag !== 'SyncUnauthenticated') {
			throw new HouseholdAdministrationError({ code: 'workos_unavailable', cause });
		}
		const code =
			'code' in cause && cause.code === 'auth_slot_missing'
				? 'auth_slot_missing'
				: 'auth_slot_expired';
		throw new HouseholdAdministrationError({ code, cause });
	}
};

const statusFor = (code: HouseholdAdministrationErrorCode): number =>
	code === 'auth_slot_missing' || code === 'auth_slot_expired'
		? 401
		: code === 'membership_inactive' ||
			  code === 'membership_projection_missing' ||
			  code === 'membership_projection_invalid' ||
			  code === 'permission_denied'
			? 403
			: code === 'household_not_found' || code === 'membership_not_found'
				? 404
				: code === 'malformed_request' ||
					  code === 'idempotency_key_required' ||
					  code === 'invite_invalid'
					? 400
					: code === 'invite_revoked' || code === 'invite_expired' || code === 'invite_exhausted'
						? 410
						: code === 'directory_managed' ||
							  code === 'last_admin' ||
							  code === 'billing_owner_required' ||
							  code === 'invite_conflict' ||
							  code === 'mutation_busy'
							? 409
							: 503;

export const householdAdministrationErrorResponse = (cause: unknown): Response => {
	const error =
		cause instanceof HouseholdAdministrationError
			? cause
			: new HouseholdAdministrationError({ code: 'd1_unavailable', cause });
	return json(
		{
			schemaVersion: 1,
			error: { _tag: 'HouseholdAdministrationError', code: error.code }
		},
		{ status: statusFor(error.code) }
	);
};

const success = (payload: unknown): Response => json({ schemaVersion: 1, payload });

export const handleHouseholdAdministrationRequest = async (
	event: RequestEvent,
	operation: HouseholdAdministrationOperation,
	dependencies: HouseholdAdministrationHttpDependencies = {}
): Promise<Response> => {
	try {
		const database = event.platform?.env.DB;
		if (!database) throw new HouseholdAdministrationError({ code: 'd1_unavailable' });
		const actor = await (dependencies.authenticate ?? defaultAuthenticate)(event);
		const service = new HouseholdAdministrationService(
			new HouseholdAdministrationRepository(database),
			dependencies.identity ?? createWorkOSHouseholdIdentityAdapter(event.platform?.env),
			dependencies.now
		);
		switch (operation) {
			case 'createHousehold': {
				const idempotencyKey = event.request.headers.get('idempotency-key')?.trim();
				if (!idempotencyKey || idempotencyKey.length > 200) {
					throw new HouseholdAdministrationError({ code: 'idempotency_key_required' });
				}
				const request = decode(CreateRemoteHouseholdRequestSchema, await readBody(event.request));
				return success(await service.createHousehold({ actor, request, idempotencyKey }));
			}
			case 'joinHousehold': {
				const request = decode(JoinRemoteHouseholdRequestSchema, await readBody(event.request));
				return success(await service.joinHousehold({ actor, code: request.code }));
			}
			case 'refreshHousehold':
				return success(await service.refreshHousehold(actor, requiredParam(event, 'householdId')));
			case 'createInvite': {
				const householdId = requiredParam(event, 'householdId');
				const request = decode(
					CreateRemoteHouseholdInviteRequestSchema,
					await readBody(event.request)
				);
				return success(await service.createInvite({ actor, householdId, request }));
			}
			case 'revokeInvite':
				return success(
					await service.revokeInvite({
						actor,
						householdId: requiredParam(event, 'householdId'),
						inviteId: requiredParam(event, 'inviteId')
					})
				);
			case 'updateMemberRole': {
				const request = decode(
					UpdateRemoteHouseholdMemberRoleRequestSchema,
					await readBody(event.request)
				);
				return success(
					await service.updateMemberRole({
						actor,
						householdId: requiredParam(event, 'householdId'),
						membershipId: requiredParam(event, 'membershipId'),
						roleSlug: request.roleSlug
					})
				);
			}
			case 'removeMember': {
				const householdId = requiredParam(event, 'householdId');
				const membershipId = requiredParam(event, 'membershipId');
				await service.removeMember({ actor, householdId, membershipId });
				return success({ householdId, membershipId, removed: true });
			}
			case 'leaveHousehold': {
				const householdId = requiredParam(event, 'householdId');
				const membershipId = await service.leaveHousehold({ actor, householdId });
				return success({ householdId, membershipId, removed: true });
			}
		}
	} catch (cause) {
		return householdAdministrationErrorResponse(cause);
	}
};
