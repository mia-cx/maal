import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import type { McpKeySummaryRecord } from '$lib/client/local/records.js';
import {
	MCP_KEY_PRESETS,
	MAAL_API_SCOPES,
	type McpKey,
	type McpKeyPreset,
	type McpScope
} from '$lib/settings/mcp-key-model.js';

type Fetch = typeof globalThis.fetch;

const NullableString = Schema.NullOr(Schema.String);
const PublicMcpKeySchema = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	preset: Schema.NullOr(Schema.Literal(...MCP_KEY_PRESETS)),
	grantMode: Schema.Literal('all', 'selected'),
	scopes: Schema.Array(Schema.Literal(...MAAL_API_SCOPES)),
	selectedHouseholdIds: Schema.Array(Schema.String),
	createdAt: Schema.String,
	expiresAt: NullableString,
	revokedAt: NullableString,
	lastUsedAt: NullableString,
	householdScope: Schema.Union(
		Schema.Struct({ kind: Schema.Literal('all') }),
		Schema.Struct({ kind: Schema.Literal('households'), householdIds: Schema.Array(Schema.String) })
	)
});

const ListMcpKeysResponseSchema = Schema.Struct({ keys: Schema.Array(PublicMcpKeySchema) });
const CreatedMcpKeyResponseSchema = Schema.Struct({
	key: Schema.String,
	record: PublicMcpKeySchema
});
const RevokedMcpKeyResponseSchema = Schema.Struct({ revoked: Schema.Literal(true) });

type PublicMcpKey = typeof PublicMcpKeySchema.Type;

const slotAndOwnerForProfile = async (
	database: MaalDatabase,
	profileId: string
): Promise<{ slotId: string; ownerUserId: string }> => {
	const [profile, slot] = await Promise.all([
		database.profiles.get(profileId),
		database.authSlots.where('profileId').equals(profileId).first()
	]);
	if (!profile || !slot || slot.sessionState === 'revoked') throw new McpKeyAuthRequired();
	return { slotId: slot.authSlotId, ownerUserId: profile.workosUserId };
};

const endpoint = (slotId: string): string =>
	`/api/auth-slots/${encodeURIComponent(slotId)}/mcp-keys`;

const safeError = async (response: Response): Promise<string> => {
	const body = await response.json().catch(() => null);
	return typeof body === 'object' && body !== null && 'error' in body
		? String(body.error)
		: `HTTP ${response.status}`;
};

const toUiKey = (record: PublicMcpKey): McpKey => ({
	id: record.id,
	label: record.label,
	householdScope:
		record.householdScope.kind === 'all'
			? { kind: 'all' }
			: { kind: 'households', householdIds: [...record.householdScope.householdIds] },
	scopes: [...record.scopes],
	...(record.preset ? { preset: record.preset } : {}),
	createdAt: record.createdAt,
	expiresAt: record.expiresAt,
	revokedAt: record.revokedAt,
	lastUsedAt: record.lastUsedAt
});

const summaryToUiKey = (record: McpKeySummaryRecord): McpKey => ({
	id: record.id,
	label: record.label,
	householdScope:
		record.householdScope.kind === 'all'
			? { kind: 'all' }
			: { kind: 'households', householdIds: [...record.householdScope.householdIds] },
	scopes: Schema.decodeUnknownSync(Schema.Array(Schema.Literal(...MAAL_API_SCOPES)))(record.scopes),
	...(record.preset ? { preset: record.preset } : {}),
	createdAt: record.createdAt,
	expiresAt: record.expiresAt,
	revokedAt: record.revokedAt,
	lastUsedAt: record.lastUsedAt
});

const toLocalSummary = (ownerUserId: string, record: PublicMcpKey): McpKeySummaryRecord => ({
	id: record.id,
	ownerUserId,
	label: record.label,
	preset: record.preset,
	grantMode: record.grantMode,
	scopes: [...record.scopes],
	selectedHouseholdIds: [...record.selectedHouseholdIds],
	householdScope:
		record.householdScope.kind === 'all'
			? { kind: 'all' }
			: { kind: 'households', householdIds: [...record.householdScope.householdIds] },
	createdAt: record.createdAt as `${string}Z`,
	expiresAt: record.expiresAt as `${string}Z` | null,
	revokedAt: record.revokedAt as `${string}Z` | null,
	lastUsedAt: record.lastUsedAt as `${string}Z` | null
});

const request = async (
	database: MaalDatabase,
	profileId: string,
	init: RequestInit,
	fetcher: Fetch
): Promise<{ response: Response; ownerUserId: string }> => {
	const { slotId, ownerUserId } = await slotAndOwnerForProfile(database, profileId);
	const response = await fetcher(endpoint(slotId), init);
	if (!response.ok) throw new McpKeyRequestFailed(await safeError(response));
	return { response, ownerUserId };
};

export const listMcpKeys = async (
	database: MaalDatabase,
	profileId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<McpKey[]> => {
	const { response, ownerUserId } = await request(
		database,
		profileId,
		{ headers: { accept: 'application/json' }, cache: 'no-store' },
		fetcher
	);
	const decoded = Schema.decodeUnknownSync(ListMcpKeysResponseSchema)(await response.json());
	await database.transaction('rw', database.mcpKeySummaries, async () => {
		await database.mcpKeySummaries.where('ownerUserId').equals(ownerUserId).delete();
		await database.mcpKeySummaries.bulkPut(
			decoded.keys.map((record) => toLocalSummary(ownerUserId, record))
		);
	});
	return decoded.keys.map(toUiKey);
};

export const listCachedMcpKeys = async (
	database: MaalDatabase,
	profileId: string
): Promise<McpKey[]> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) return [];
	return (
		await database.mcpKeySummaries.where('ownerUserId').equals(profile.workosUserId).toArray()
	)
		.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
		.map(summaryToUiKey);
};

export const createMcpKey = async (
	database: MaalDatabase,
	profileId: string,
	input: {
		label: string;
		preset?: McpKeyPreset;
		scopes: readonly McpScope[];
		householdScope: { kind: 'all' } | { kind: 'households'; householdIds: readonly string[] };
	},
	fetcher: Fetch = globalThis.fetch
): Promise<{ key: string; record: McpKey }> => {
	const { response, ownerUserId } = await request(
		database,
		profileId,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				label: input.label,
				...(input.preset ? { preset: input.preset } : {}),
				grantMode: input.householdScope.kind === 'all' ? 'all' : 'selected',
				scopes: input.scopes,
				selectedHouseholdIds:
					input.householdScope.kind === 'households' ? input.householdScope.householdIds : []
			})
		},
		fetcher
	);
	const decoded = Schema.decodeUnknownSync(CreatedMcpKeyResponseSchema)(await response.json());
	await database.mcpKeySummaries.put(toLocalSummary(ownerUserId, decoded.record));
	return { key: decoded.key, record: toUiKey(decoded.record) };
};

export const rerollMcpKey = async (
	database: MaalDatabase,
	profileId: string,
	keyId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<{ key: string; record: McpKey }> => {
	const { response, ownerUserId } = await request(
		database,
		profileId,
		{
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ keyId })
		},
		fetcher
	);
	const decoded = Schema.decodeUnknownSync(CreatedMcpKeyResponseSchema)(await response.json());
	await database.transaction('rw', database.mcpKeySummaries, async () => {
		await database.mcpKeySummaries.update(keyId, {
			revokedAt: decoded.record.createdAt as `${string}Z`
		});
		await database.mcpKeySummaries.put(toLocalSummary(ownerUserId, decoded.record));
	});
	return { key: decoded.key, record: toUiKey(decoded.record) };
};

export const revokeMcpKey = async (
	database: MaalDatabase,
	profileId: string,
	keyId: string,
	fetcher: Fetch = globalThis.fetch
): Promise<void> => {
	const { response } = await request(
		database,
		profileId,
		{
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ keyId })
		},
		fetcher
	);
	Schema.decodeUnknownSync(RevokedMcpKeyResponseSchema)(await response.json());
	await database.mcpKeySummaries.update(keyId, {
		revokedAt: new Date().toISOString() as `${string}Z`
	});
};

export class McpKeyAuthRequired extends Error {
	readonly _tag = 'McpKeyAuthRequired';
	constructor() {
		super('Reauthenticate this profile to manage MCP keys.');
	}
}

export class McpKeyRequestFailed extends Error {
	readonly _tag = 'McpKeyRequestFailed';
	constructor(readonly safeMessage: string) {
		super('The MCP key request failed.');
	}
}
