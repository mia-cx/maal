import { Schema } from 'effect';
import type { RequestHandler } from './$types';

import {
	MAAL_API_SCOPES,
	MCP_KEY_PRESETS,
	McpKeyRepository,
	type MaalApiScope,
	type McpKeyPreset
} from '$lib/server/mcp/index.js';
import { authenticateSyncSlot } from '$lib/server/sync/auth.js';

const CreateKeySchema = Schema.Struct({
	label: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(80)),
	preset: Schema.optional(Schema.Literal(...MCP_KEY_PRESETS)),
	grantMode: Schema.Literal('all', 'selected'),
	scopes: Schema.Array(Schema.Literal(...MAAL_API_SCOPES)).pipe(Schema.minItems(1)),
	selectedHouseholdIds: Schema.optional(Schema.Array(Schema.String.pipe(Schema.minLength(1)))),
	expiresAt: Schema.optional(Schema.NullOr(Schema.String))
});

const KeyIdSchema = Schema.Struct({ keyId: Schema.String.pipe(Schema.minLength(1)) });

const noStore = { 'cache-control': 'no-store' };

const readJson = async <A, I>(request: Request, schema: Schema.Schema<A, I>): Promise<A> => {
	if (Number(request.headers.get('content-length') ?? 0) > 32_768) {
		throw new TypeError('request_too_large');
	}
	return Schema.decodeUnknownSync(schema)(await request.json());
};

const assertSelectedHouseholds = async (input: {
	database: D1Database;
	ownerUserId: string;
	activeOrganizationIds: readonly string[];
	householdIds: readonly string[];
}): Promise<void> => {
	const householdIds = [...new Set(input.householdIds)];
	if (householdIds.length === 0) throw new TypeError('household_required');
	const live = new Set(input.activeOrganizationIds);
	if (householdIds.some((householdId) => !live.has(householdId))) {
		throw new TypeError('household_forbidden');
	}
	const placeholders = householdIds.map(() => '?').join(', ');
	const rows = (
		await input.database
			.prepare(
				`SELECT household_id FROM household_memberships
				 WHERE workos_user_id = ? AND status = 'active'
				 AND household_id IN (${placeholders})`
			)
			.bind(input.ownerUserId, ...householdIds)
			.all<{ household_id: string }>()
	).results;
	if (rows.length !== householdIds.length) throw new TypeError('household_forbidden');
};

const keyErrorResponse = (cause: unknown): Response => {
	const tag = cause && typeof cause === 'object' && '_tag' in cause ? cause._tag : null;
	const code = cause instanceof TypeError ? cause.message : tag;
	const status =
		tag === 'SyncUnauthenticated'
			? 401
			: code === 'household_forbidden'
				? 403
				: code === 'not_found'
					? 404
					: cause instanceof TypeError || tag === 'ParseError'
						? 400
						: 503;
	return Response.json(
		{ error: status === 503 ? 'mcp_key_storage_unavailable' : (code ?? 'invalid_request') },
		{ status, headers: noStore }
	);
};

export const GET: RequestHandler = async (event) => {
	try {
		const environment = event.platform?.env;
		if (!environment?.DB) throw new Error('database_unavailable');
		const actor = await authenticateSyncSlot(event);
		return Response.json(
			{ keys: await new McpKeyRepository(environment.DB).list(actor.workosUserId) },
			{ headers: noStore }
		);
	} catch (cause) {
		return keyErrorResponse(cause);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const environment = event.platform?.env;
		if (!environment?.DB) throw new Error('database_unavailable');
		const [actor, body] = await Promise.all([
			authenticateSyncSlot(event),
			readJson(event.request, CreateKeySchema)
		]);
		const selectedHouseholdIds = [...new Set(body.selectedHouseholdIds ?? [])];
		if (body.grantMode === 'selected') {
			await assertSelectedHouseholds({
				database: environment.DB,
				ownerUserId: actor.workosUserId,
				activeOrganizationIds: actor.activeOrganizationIds,
				householdIds: selectedHouseholdIds
			});
		} else if (selectedHouseholdIds.length > 0) {
			throw new TypeError('all_grant_cannot_select_households');
		}
		if (body.expiresAt !== undefined && body.expiresAt !== null) {
			const expiry = new Date(body.expiresAt);
			if (Number.isNaN(expiry.getTime()) || expiry.toISOString() <= new Date().toISOString()) {
				throw new TypeError('invalid_expiry');
			}
		}
		const created = await new McpKeyRepository(environment.DB).create({
			ownerUserId: actor.workosUserId,
			label: body.label,
			preset: (body.preset ?? null) as McpKeyPreset | null,
			grantMode: body.grantMode,
			scopes: body.scopes as readonly MaalApiScope[],
			selectedHouseholdIds,
			expiresAt: body.expiresAt ?? null
		});
		return Response.json(created, { status: 201, headers: noStore });
	} catch (cause) {
		return keyErrorResponse(cause);
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const environment = event.platform?.env;
		if (!environment?.DB) throw new Error('database_unavailable');
		const [actor, body] = await Promise.all([
			authenticateSyncSlot(event),
			readJson(event.request, KeyIdSchema)
		]);
		const created = await new McpKeyRepository(environment.DB).reroll(
			actor.workosUserId,
			body.keyId
		);
		if (!created) throw new TypeError('not_found');
		return Response.json(created, { headers: noStore });
	} catch (cause) {
		return keyErrorResponse(cause);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const environment = event.platform?.env;
		if (!environment?.DB) throw new Error('database_unavailable');
		const [actor, body] = await Promise.all([
			authenticateSyncSlot(event),
			readJson(event.request, KeyIdSchema)
		]);
		if (!(await new McpKeyRepository(environment.DB).revoke(actor.workosUserId, body.keyId))) {
			throw new TypeError('not_found');
		}
		return Response.json({ revoked: true }, { headers: noStore });
	} catch (cause) {
		return keyErrorResponse(cause);
	}
};
