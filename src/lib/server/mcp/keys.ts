import { Effect, Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { decodeMcpScopes, encodeMcpScopes } from '$lib/server/db/contracts.js';

import {
	MAAL_API_SCOPES,
	MCP_KEY_PREFIX,
	type CreatedMcpKey,
	type MaalApiScope,
	type McpGrantMode,
	type McpKeyPreset,
	type McpKeyRecord,
	type PublicMcpKey
} from './contracts.js';

interface McpKeyRow {
	id: string;
	owner_user_id: string;
	key_hash: string;
	label: string;
	preset: McpKeyPreset | null;
	grant_mode: McpGrantMode;
	scopes: string;
	created_at: string;
	expires_at: string | null;
	revoked_at: string | null;
	last_used_at: string | null;
}

const scopeSet = new Set<string>(MAAL_API_SCOPES);
export const MCP_ACTIVE_KEY_LIMIT = 8;
export const MCP_KEY_CREATION_DAILY_LIMIT = 20;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export class McpKeyLimitError extends Error {
	readonly _tag = 'McpKeyLimitError';
	constructor(readonly reason: 'active_key_limit' | 'key_creation_rate_limit') {
		super('The MCP key limit has been reached.');
	}
}

export const canonicalMcpKeyExpiry = (value: string, now: string): string => {
	const expiry = new Date(value);
	if (
		Number.isNaN(expiry.getTime()) ||
		expiry.toISOString() !== value ||
		expiry.getTime() <= Date.parse(now)
	) {
		throw new TypeError('invalid_expiry');
	}
	return expiry.toISOString();
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
};

const bufferToHex = (buffer: ArrayBuffer): string =>
	[...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const hashMcpKey = async (rawKey: string): Promise<string> =>
	bufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey)));

const randomKey = (): string => {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `${MCP_KEY_PREFIX}${bytesToBase64Url(bytes)}`;
};

const decodeScopes = (encoded: string): readonly MaalApiScope[] => {
	const decoded = Effect.runSync(decodeMcpScopes(encoded));
	if (!decoded.every((scope) => scopeSet.has(scope))) throw new TypeError('Invalid MCP scope row.');
	return Schema.decodeUnknownSync(Schema.Array(Schema.Literal(...MAAL_API_SCOPES)))(decoded);
};

const selectedHouseholds = async (database: D1Database, keyId: string): Promise<string[]> =>
	(
		await database
			.prepare('SELECT household_id FROM mcp_key_households WHERE key_id = ? ORDER BY household_id')
			.bind(keyId)
			.all<{ household_id: string }>()
	).results.map(({ household_id }) => household_id);

const recordFromRow = async (database: D1Database, row: McpKeyRow): Promise<McpKeyRecord> => ({
	id: row.id,
	ownerUserId: row.owner_user_id,
	keyHash: row.key_hash,
	label: row.label,
	preset: row.preset,
	grantMode: row.grant_mode,
	scopes: decodeScopes(row.scopes),
	selectedHouseholdIds:
		row.grant_mode === 'selected' ? await selectedHouseholds(database, row.id) : [],
	createdAt: row.created_at,
	expiresAt: row.expires_at,
	revokedAt: row.revoked_at,
	lastUsedAt: row.last_used_at
});

const publicRecord = (record: McpKeyRecord): PublicMcpKey => ({
	id: record.id,
	label: record.label,
	preset: record.preset,
	grantMode: record.grantMode,
	scopes: record.scopes,
	selectedHouseholdIds: record.selectedHouseholdIds,
	createdAt: record.createdAt,
	expiresAt: record.expiresAt,
	revokedAt: record.revokedAt,
	lastUsedAt: record.lastUsedAt,
	householdScope:
		record.grantMode === 'all'
			? { kind: 'all' }
			: { kind: 'households', householdIds: record.selectedHouseholdIds }
});

export class McpKeyRepository {
	constructor(private readonly database: D1Database) {}

	async create(input: {
		ownerUserId: string;
		label: string;
		preset: McpKeyPreset | null;
		grantMode: McpGrantMode;
		scopes: readonly MaalApiScope[];
		selectedHouseholdIds?: readonly string[];
		expiresAt?: string | null;
		now?: string;
	}): Promise<CreatedMcpKey> {
		const scopes = [...new Set(input.scopes)];
		if (scopes.length === 0 || !scopes.every((scope) => scopeSet.has(scope))) {
			throw new TypeError('At least one valid MCP scope is required.');
		}
		const householdIds = [...new Set(input.selectedHouseholdIds ?? [])];
		if (input.grantMode === 'selected' && householdIds.length === 0) {
			throw new TypeError('Selected MCP grants require a household.');
		}
		if (input.grantMode === 'all' && householdIds.length > 0) {
			throw new TypeError('All-household MCP grants cannot persist selected rows.');
		}
		const rawKey = randomKey();
		const now = input.now ?? new Date().toISOString();
		const expiresAt = input.expiresAt ? canonicalMcpKeyExpiry(input.expiresAt, now) : null;
		const creationCutoff = new Date(Date.parse(now) - DAY_MILLISECONDS).toISOString();
		const id = uuidv7();
		await this.database.batch([
			this.database
				.prepare(
					`INSERT INTO mcp_keys
					 (id, owner_user_id, key_hash, label, preset, grant_mode, scopes, created_at,
					  expires_at, revoked_at, last_used_at)
					 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL
					 WHERE (SELECT COUNT(*) FROM mcp_keys
					        WHERE owner_user_id = ? AND revoked_at IS NULL
					        AND (expires_at IS NULL OR expires_at > ?)) < ?
					   AND (SELECT COUNT(*) FROM mcp_keys
					        WHERE owner_user_id = ? AND created_at >= ?) < ?`
				)
				.bind(
					id,
					input.ownerUserId,
					await hashMcpKey(rawKey),
					input.label.trim(),
					input.preset,
					input.grantMode,
					Effect.runSync(encodeMcpScopes(scopes)),
					now,
					expiresAt,
					input.ownerUserId,
					now,
					MCP_ACTIVE_KEY_LIMIT,
					input.ownerUserId,
					creationCutoff,
					MCP_KEY_CREATION_DAILY_LIMIT
				),
			...householdIds.map((householdId) =>
				this.database
					.prepare(
						`INSERT INTO mcp_key_households (key_id, household_id)
						 SELECT ?, ? WHERE EXISTS (SELECT 1 FROM mcp_keys WHERE id = ?)`
					)
					.bind(id, householdId, id)
			)
		]);
		const record = await this.byId(input.ownerUserId, id);
		if (!record) {
			const limits = await this.keyLimitState(input.ownerUserId, now);
			throw new McpKeyLimitError(
				limits.active >= MCP_ACTIVE_KEY_LIMIT ? 'active_key_limit' : 'key_creation_rate_limit'
			);
		}
		return { key: rawKey, record: publicRecord(record) };
	}

	async byRawKey(rawKey: string): Promise<McpKeyRecord | null> {
		const row = await this.database
			.prepare('SELECT * FROM mcp_keys WHERE key_hash = ?')
			.bind(await hashMcpKey(rawKey))
			.first<McpKeyRow>();
		return row ? recordFromRow(this.database, row) : null;
	}

	async byId(ownerUserId: string, id: string): Promise<McpKeyRecord | null> {
		const row = await this.database
			.prepare('SELECT * FROM mcp_keys WHERE id = ? AND owner_user_id = ?')
			.bind(id, ownerUserId)
			.first<McpKeyRow>();
		return row ? recordFromRow(this.database, row) : null;
	}

	async list(ownerUserId: string): Promise<readonly PublicMcpKey[]> {
		const rows = (
			await this.database
				.prepare('SELECT * FROM mcp_keys WHERE owner_user_id = ? ORDER BY created_at DESC')
				.bind(ownerUserId)
				.all<McpKeyRow>()
		).results;
		return Promise.all(
			rows.map(async (row) => publicRecord(await recordFromRow(this.database, row)))
		);
	}

	async touch(id: string, now: string): Promise<void> {
		await this.database
			.prepare('UPDATE mcp_keys SET last_used_at = ? WHERE id = ?')
			.bind(now, id)
			.run();
	}

	async revoke(ownerUserId: string, id: string, now = new Date().toISOString()): Promise<boolean> {
		const result = await this.database
			.prepare(
				'UPDATE mcp_keys SET revoked_at = ? WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL'
			)
			.bind(now, id, ownerUserId)
			.run();
		return result.meta.changes > 0;
	}

	async reroll(
		ownerUserId: string,
		id: string,
		now = new Date().toISOString()
	): Promise<CreatedMcpKey | null> {
		const rawKey = randomKey();
		const nextId = uuidv7();
		const creationCutoff = new Date(Date.parse(now) - DAY_MILLISECONDS).toISOString();
		await this.database.batch([
			this.database
				.prepare(
					`INSERT INTO mcp_keys
					 (id, owner_user_id, key_hash, label, preset, grant_mode, scopes, created_at,
					  expires_at, revoked_at, last_used_at)
					 SELECT ?, owner_user_id, ?, label, preset, grant_mode, scopes, ?,
					        expires_at, NULL, NULL
					 FROM mcp_keys
					 WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL
					 AND (SELECT COUNT(*) FROM mcp_keys
					      WHERE owner_user_id = ? AND created_at >= ?) < ?`
				)
				.bind(
					nextId,
					await hashMcpKey(rawKey),
					now,
					id,
					ownerUserId,
					ownerUserId,
					creationCutoff,
					MCP_KEY_CREATION_DAILY_LIMIT
				),
			this.database
				.prepare(
					`INSERT INTO mcp_key_households (key_id, household_id)
					 SELECT ?, household_id FROM mcp_key_households
					 WHERE key_id = ? AND EXISTS (SELECT 1 FROM mcp_keys WHERE id = ?)`
				)
				.bind(nextId, id, nextId),
			this.database
				.prepare(
					`UPDATE mcp_keys SET revoked_at = ?
					 WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL
					 AND EXISTS (SELECT 1 FROM mcp_keys WHERE id = ?)`
				)
				.bind(now, id, ownerUserId, nextId)
		]);
		const record = await this.byId(ownerUserId, nextId);
		if (!record) {
			const source = await this.byId(ownerUserId, id);
			if (source?.revokedAt === null) throw new McpKeyLimitError('key_creation_rate_limit');
			return null;
		}
		return { key: rawKey, record: publicRecord(record) };
	}

	private async keyLimitState(
		ownerUserId: string,
		now: string
	): Promise<{
		active: number;
		recent: number;
	}> {
		const creationCutoff = new Date(Date.parse(now) - DAY_MILLISECONDS).toISOString();
		return (
			(await this.database
				.prepare(
					`SELECT
					 (SELECT COUNT(*) FROM mcp_keys WHERE owner_user_id = ? AND revoked_at IS NULL
					  AND (expires_at IS NULL OR expires_at > ?)) AS active,
					 (SELECT COUNT(*) FROM mcp_keys WHERE owner_user_id = ? AND created_at >= ?) AS recent`
				)
				.bind(ownerUserId, now, ownerUserId, creationCutoff)
				.first<{ active: number; recent: number }>()) ?? { active: 0, recent: 0 }
		);
	}
}
