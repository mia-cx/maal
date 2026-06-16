import { timestampExpired } from './expiry';
import { listUserHouseholds, type UserHousehold } from '$lib/server/auth/household';

export type MaalApiScope =
	| 'households:read'
	| 'households:write'
	| 'recipes:read'
	| 'recipes:write'
	| 'meals:read'
	| 'meals:write'
	| 'check_ins:read'
	| 'check_ins:write'
	| 'food_profile:read'
	| 'food_profile:write';

export const MAAL_API_SCOPES: MaalApiScope[] = [
	'households:read',
	'households:write',
	'recipes:read',
	'recipes:write',
	'meals:read',
	'meals:write',
	'check_ins:read',
	'check_ins:write',
	'food_profile:read',
	'food_profile:write'
];

export const MCP_KEY_PREFIX = 'mk_';
export const MCP_KEY_KV_PREFIX = 'mk:';
const MCP_KEY_USER_INDEX_PREFIX = 'mku:';

export type McpKeyPreset = 'read_only_planner' | 'meal_planner' | 'full_access';

export type McpKeyHouseholdScope = { kind: 'all' } | { kind: 'households'; householdIds: string[] };

export type McpKeyRecord = {
	id: string;
	userId: string;
	householdScope: McpKeyHouseholdScope;
	scopes: MaalApiScope[];
	label: string;
	preset?: McpKeyPreset;
	createdAt: string;
	expiresAt?: string | null;
	revokedAt?: string | null;
	lastUsedAt?: string | null;
};

export type PublicMcpKey = Omit<McpKeyRecord, 'userId'> & {
	households?: UserHousehold[];
};

export type CreatedMcpKey = {
	key: string;
	record: PublicMcpKey;
};

const encoder = new TextEncoder();
const maalApiScopeSet = new Set<string>(MAAL_API_SCOPES);
const mcpKeyPresets = new Set<string>(['read_only_planner', 'meal_planner', 'full_access']);

const bytesToBase64Url = (bytes: Uint8Array): string => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const bufferToHex = (buffer: ArrayBuffer): string =>
	[...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export const hashMcpKey = async (rawKey: string): Promise<string> =>
	bufferToHex(await crypto.subtle.digest('SHA-256', encoder.encode(rawKey)));

const kvKeyForRawKey = async (rawKey: string): Promise<string> =>
	`${MCP_KEY_KV_PREFIX}${await hashMcpKey(rawKey)}`;

const randomSecret = (): string => {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToBase64Url(bytes);
};

const getMcpKeyStore = (platform: App.Platform | undefined): KVNamespace => {
	const store = platform?.env.MCP_KEYS;
	if (!store) throw new Error('MCP_KEYS KV binding is not configured');
	return store;
};

const stringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string');

const validHouseholdScope = (value: unknown): value is McpKeyHouseholdScope => {
	if (!value || typeof value !== 'object') return false;
	const scope = value as { kind?: unknown; householdIds?: unknown };
	if (scope.kind === 'all') return true;
	return scope.kind === 'households' && stringArray(scope.householdIds);
};

const validTimestamp = (value: unknown): value is string | null | undefined =>
	value === undefined ||
	value === null ||
	(typeof value === 'string' && !timestampExpired(value, 0));

const validMcpRecord = (record: unknown): record is McpKeyRecord => {
	if (!record || typeof record !== 'object') return false;
	const candidate = record as Partial<McpKeyRecord>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.userId === 'string' &&
		typeof candidate.label === 'string' &&
		validHouseholdScope(candidate.householdScope) &&
		Array.isArray(candidate.scopes) &&
		candidate.scopes.every((scope) => maalApiScopeSet.has(scope)) &&
		(candidate.preset === undefined || mcpKeyPresets.has(candidate.preset)) &&
		typeof candidate.createdAt === 'string' &&
		validTimestamp(candidate.createdAt) &&
		validTimestamp(candidate.expiresAt) &&
		validTimestamp(candidate.revokedAt) &&
		validTimestamp(candidate.lastUsedAt)
	);
};

const readRecord = async (store: KVNamespace, key: string): Promise<McpKeyRecord | null> => {
	const record = await store.get<unknown>(key, 'json');
	return validMcpRecord(record) ? record : null;
};

const listRecordKeys = async (store: KVNamespace): Promise<string[]> => {
	const names: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await store.list({ prefix: MCP_KEY_KV_PREFIX, cursor });
		names.push(...page.keys.map((key) => key.name));
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return names;
};

type McpKeyUserIndex = { keyNames: string[]; rebuiltAt?: string };
type KeyedMcpRecord = { keyName: string; record: McpKeyRecord };

const userIndexKey = (userId: string): string => `${MCP_KEY_USER_INDEX_PREFIX}${userId}`;

const readUserIndex = async (
	store: KVNamespace,
	userId: string
): Promise<{ exists: boolean; keyNames: string[] }> => {
	const index = await store.get<McpKeyUserIndex>(userIndexKey(userId), 'json');
	return {
		exists: Boolean(index && Array.isArray(index.keyNames)),
		keyNames: Array.isArray(index?.keyNames)
			? index.keyNames.filter((keyName): keyName is string => typeof keyName === 'string')
			: []
	};
};

const writeUserIndex = async (store: KVNamespace, userId: string, keyNames: string[]) => {
	await store.put(
		userIndexKey(userId),
		JSON.stringify({ keyNames: [...new Set(keyNames)], rebuiltAt: new Date().toISOString() })
	);
};

const addToUserIndex = async (store: KVNamespace, userId: string, keyName: string) => {
	await writeUserIndex(store, userId, [...(await readUserIndex(store, userId)).keyNames, keyName]);
};

const indexedRecordsForUser = async (
	store: KVNamespace,
	userId: string
): Promise<{ records: KeyedMcpRecord[]; needsRepair: boolean }> => {
	const index = await readUserIndex(store, userId);
	const { keyNames } = index;
	const indexedRecords = await Promise.all(
		keyNames.map(async (keyName) => ({ keyName, record: await readRecord(store, keyName) }))
	);
	const records = indexedRecords.filter(
		(entry): entry is KeyedMcpRecord => entry.record?.userId === userId
	);
	return { records, needsRepair: !index.exists || records.length !== keyNames.length };
};

const scanRecordsForUser = async (
	store: KVNamespace,
	userId: string
): Promise<KeyedMcpRecord[]> => {
	const allRecords = await Promise.all(
		(await listRecordKeys(store)).map(async (keyName) => ({
			keyName,
			record: await readRecord(store, keyName)
		}))
	);
	const userRecords = allRecords.filter(
		(entry): entry is KeyedMcpRecord => entry.record?.userId === userId
	);
	await writeUserIndex(
		store,
		userId,
		userRecords.map((entry) => entry.keyName)
	);
	return userRecords;
};

const findRecordForUser = async (
	store: KVNamespace,
	userId: string,
	keyId: string
): Promise<{ records: KeyedMcpRecord[]; match: KeyedMcpRecord | null }> => {
	const indexed = await indexedRecordsForUser(store, userId);
	const indexedMatch = indexed.records.find((entry) => entry.record.id === keyId);
	if (indexedMatch && !indexed.needsRepair)
		return { records: indexed.records, match: indexedMatch };

	const repairedRecords = await scanRecordsForUser(store, userId);
	return {
		records: repairedRecords,
		match: repairedRecords.find((entry) => entry.record.id === keyId) ?? null
	};
};

export const presetScopes = (preset: McpKeyPreset): MaalApiScope[] => {
	if (preset === 'read_only_planner') return ['households:read', 'recipes:read', 'meals:read'];
	if (preset === 'meal_planner') {
		return ['households:read', 'recipes:read', 'meals:read', 'meals:write', 'check_ins:write'];
	}
	return [...MAAL_API_SCOPES];
};

export const createMcpKey = async (input: {
	platform: App.Platform | undefined;
	userId: string;
	label: string;
	householdScope: McpKeyHouseholdScope;
	scopes: MaalApiScope[];
	preset?: McpKeyPreset;
	expiresAt?: string | null;
}): Promise<CreatedMcpKey> => {
	const store = getMcpKeyStore(input.platform);
	const rawKey = `${MCP_KEY_PREFIX}${randomSecret()}`;
	const record: McpKeyRecord = {
		id: crypto.randomUUID(),
		userId: input.userId,
		label: input.label,
		householdScope: input.householdScope,
		scopes: input.scopes,
		...(input.preset ? { preset: input.preset } : {}),
		createdAt: new Date().toISOString(),
		expiresAt: input.expiresAt ?? null,
		revokedAt: null,
		lastUsedAt: null
	};
	const keyName = await kvKeyForRawKey(rawKey);
	await store.put(keyName, JSON.stringify(record));
	await addToUserIndex(store, input.userId, keyName);
	return { key: rawKey, record: toPublicMcpKey(record) };
};

export const verifyMcpKey = async (input: {
	platform: App.Platform | undefined;
	rawKey: string;
}): Promise<McpKeyRecord | null> => {
	if (!input.rawKey.startsWith(MCP_KEY_PREFIX)) return null;
	const store = getMcpKeyStore(input.platform);
	const key = await kvKeyForRawKey(input.rawKey);
	const record = await readRecord(store, key);
	if (!record || record.revokedAt) return null;
	if (timestampExpired(record.expiresAt)) return null;
	await store.put(key, JSON.stringify({ ...record, lastUsedAt: new Date().toISOString() }));
	return record;
};

export const listMcpKeys = async (input: {
	platform: App.Platform | undefined;
	userId: string;
}): Promise<PublicMcpKey[]> => {
	const store = getMcpKeyStore(input.platform);
	const userRecords = (await scanRecordsForUser(store, input.userId))
		.map((entry) => entry.record)
		.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
	const households = await listUserHouseholds(input.platform, input.userId).catch(() => []);
	const householdById = new Map(households.map((household) => [household.id, household]));
	return userRecords.map((record) =>
		toPublicMcpKey(
			record,
			record.householdScope.kind === 'households'
				? record.householdScope.householdIds
						.map((id) => householdById.get(id))
						.filter((household): household is UserHousehold => Boolean(household))
				: households
		)
	);
};

export const rerollMcpKey = async (input: {
	platform: App.Platform | undefined;
	userId: string;
	keyId: string;
}): Promise<CreatedMcpKey | null> => {
	const store = getMcpKeyStore(input.platform);
	const { records, match } = await findRecordForUser(store, input.userId, input.keyId);
	if (!match) return null;
	if (match.record.revokedAt) return null;

	const rawKey = `${MCP_KEY_PREFIX}${randomSecret()}`;
	const nextKeyName = await kvKeyForRawKey(rawKey);
	const nextRecord = { ...match.record, lastUsedAt: null };
	await store.put(nextKeyName, JSON.stringify(nextRecord));
	await store.delete(match.keyName);
	await writeUserIndex(
		store,
		input.userId,
		records.map((entry) => (entry.keyName === match.keyName ? nextKeyName : entry.keyName))
	);
	return { key: rawKey, record: toPublicMcpKey(nextRecord) };
};

export const revokeMcpKey = async (input: {
	platform: App.Platform | undefined;
	userId: string;
	keyId: string;
}): Promise<boolean> => {
	const store = getMcpKeyStore(input.platform);
	const { match } = await findRecordForUser(store, input.userId, input.keyId);
	if (!match) return false;
	await store.put(
		match.keyName,
		JSON.stringify({ ...match.record, revokedAt: new Date().toISOString() })
	);
	return true;
};

export const toPublicMcpKey = (
	record: McpKeyRecord,
	households?: UserHousehold[]
): PublicMcpKey => ({
	id: record.id,
	label: record.label,
	householdScope: record.householdScope,
	scopes: record.scopes,
	...(record.preset ? { preset: record.preset } : {}),
	createdAt: record.createdAt,
	expiresAt: record.expiresAt,
	revokedAt: record.revokedAt,
	lastUsedAt: record.lastUsedAt,
	...(households ? { households } : {})
});

export const scopeAllowsHousehold = async (input: {
	platform: App.Platform | undefined;
	record: McpKeyRecord;
	householdId: string;
}): Promise<boolean> => {
	if (input.record.householdScope.kind === 'households') {
		return input.record.householdScope.householdIds.includes(input.householdId);
	}
	return (await listUserHouseholds(input.platform, input.record.userId)).some(
		(household) => household.id === input.householdId
	);
};

export const oneScopedHouseholdId = (record: McpKeyRecord): string | null =>
	record.householdScope.kind === 'households' && record.householdScope.householdIds.length === 1
		? record.householdScope.householdIds[0]
		: null;
