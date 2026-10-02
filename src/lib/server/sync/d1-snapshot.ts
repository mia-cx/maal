/**
 * Batched D1 reads shared by the user and household sync repositories. Every helper here costs a
 * fixed number of statements, whatever the size of the scope it reads.
 */
import type { MutationReceipt } from '$lib/sync/contracts.js';

export type SqlValue = string | number | null | ArrayBuffer;
export type AudienceKind = 'user' | 'household';

export interface EntityIdentity<Kind extends string = string> {
	readonly entityKind: Kind;
	readonly entityId: string;
}

export interface CommitResult {
	readonly receipt: MutationReceipt;
	/** The aggregate this commit stored, or null for duplicate and rejected mutations. */
	readonly aggregate: unknown | null;
}

/** One JSON parameter carries any number of IDs, so reads never hit D1's bound-parameter cap. */
export const JSON_IDS = 'SELECT value FROM json_each(?)';
export const JSON_IDENTITIES = `SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
	FROM json_each(?)`;
const MANIFEST_CHUNK_SIZE = 1_000;

export const assertIdentifier = (value: string): string => {
	if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new TypeError('Unsafe SQL identifier.');
	return `"${value}"`;
};

export const kindLiteral = (kind: string): string => {
	if (!/^[A-Za-z_]+$/.test(kind)) throw new TypeError('Unsafe entity kind literal.');
	return `'${kind}'`;
};

const snakeToCamel = (value: string): string =>
	value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

export const camelize = (
	row: Record<string, unknown>,
	omitted: readonly string[] = []
): Record<string, unknown> => {
	const omit = new Set(omitted);
	return Object.fromEntries(
		Object.entries(row)
			.filter(([key]) => !omit.has(key))
			.map(([key, value]) => [snakeToCamel(key), value])
	);
};

export const queryAll = async <T = Record<string, unknown>>(
	database: D1Database,
	sql: string,
	...values: SqlValue[]
): Promise<T[]> =>
	(
		await database
			.prepare(sql)
			.bind(...values)
			.all<T>()
	).results;

export const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> => {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const group = groups.get(key(item));
		if (group) group.push(item);
		else groups.set(key(item), [item]);
	}
	return groups;
};

export const entityKey = (kind: string, id: string): string => `${kind}\u0000${id}`;

export const identitiesJson = (identities: readonly EntityIdentity[]): string =>
	JSON.stringify(identities.map(({ entityKind, entityId }) => [entityKind, entityId]));

const splitEntityKey = (key: string): [string, string] => {
	const separator = key.indexOf('\u0000');
	return separator === -1 ? [key, ''] : [key.slice(0, separator), key.slice(separator + 1)];
};

/**
 * Lists held entities in entity-key order, optionally after a key, within kinds, or up to a
 * limit. `heldSql` is a predicate on the version row `v` with the audience ID bound as `?1`.
 */
export const listHeldIdentities = async <Kind extends string>(
	database: D1Database,
	audience: { readonly kind: AudienceKind; readonly id: string },
	heldSql: string,
	options: {
		readonly afterEntityKey?: string | null;
		readonly kinds?: readonly Kind[];
		readonly limit?: number;
	}
): Promise<EntityIdentity<Kind>[]> => {
	const params: SqlValue[] = [audience.id];
	const parameter = (value: SqlValue) => {
		params.push(value);
		return `?${params.length}`;
	};
	const filters: string[] = [];
	if (options.kinds) {
		filters.push(`v.entity_kind IN (${options.kinds.map((kind) => parameter(kind)).join(', ')})`);
	}
	if (options.afterEntityKey != null) {
		const [kind, id] = splitEntityKey(options.afterEntityKey);
		filters.push(`(v.entity_kind, v.entity_id) > (${parameter(kind)}, ${parameter(id)})`);
	}
	const limit = options.limit === undefined ? '' : `LIMIT ${parameter(options.limit)}`;
	const rows = await queryAll<{ entity_kind: Kind; entity_id: string }>(
		database,
		`SELECT DISTINCT v.entity_kind, v.entity_id FROM sync_entity_versions v
		 WHERE v.audience_kind = ${kindLiteral(audience.kind)} AND v.audience_id = ?1
		 ${filters.map((filter) => `AND ${filter}`).join(' ')}
		 AND ${heldSql}
		 ORDER BY v.entity_kind, v.entity_id ${limit}`,
		...params
	);
	return rows.map((row) => ({ entityKind: row.entity_kind, entityId: row.entity_id }));
};

/** Returns the entity keys of the manifest entries the audience still holds. */
export const heldManifestKeys = async (
	database: D1Database,
	audience: { readonly kind: AudienceKind; readonly id: string },
	heldSql: string,
	manifest: readonly EntityIdentity[]
): Promise<Set<string>> => {
	const chunks: EntityIdentity[][] = [];
	for (let index = 0; index < manifest.length; index += MANIFEST_CHUNK_SIZE) {
		chunks.push(manifest.slice(index, index + MANIFEST_CHUNK_SIZE));
	}
	const rows = await Promise.all(
		chunks.map((chunk) =>
			queryAll<{ entity_kind: string; entity_id: string }>(
				database,
				`SELECT DISTINCT v.entity_kind, v.entity_id FROM sync_entity_versions v
				 WHERE v.audience_kind = ${kindLiteral(audience.kind)} AND v.audience_id = ?1
				 AND (v.entity_kind, v.entity_id) IN (
				  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?2))
				 AND ${heldSql}`,
				audience.id,
				identitiesJson(chunk)
			)
		)
	);
	return new Set(rows.flat().map((row) => entityKey(row.entity_kind, row.entity_id)));
};

/** Sidecar reads for recipes or meals, ordered to match the order the aggregate wrote them. */
const sidecarReads = (owner: 'recipe' | 'meal') => {
	const ownerId = `${owner}_id`;
	const within = `${ownerId} IN (${JSON_IDS})`;
	return [
		[
			'ingredients',
			`SELECT * FROM ${owner}_ingredients WHERE ${within} ORDER BY ${ownerId}, line_index`,
			['optional']
		],
		[
			'instructions',
			`SELECT * FROM ${owner}_instructions WHERE ${within} ORDER BY ${ownerId}, step_index`,
			[]
		],
		[
			'instructionEvents',
			`SELECT e.*, i.${ownerId} FROM ${owner}_instruction_events e
			 JOIN ${owner}_instructions i ON i.id = e.${owner}_instruction_id
			 WHERE i.${within} ORDER BY i.${ownerId}, i.step_index, e.rowid`,
			[]
		],
		[
			'applianceRequirements',
			`SELECT * FROM ${owner}_appliance_requirements WHERE ${within}
			 ORDER BY ${ownerId}, appliance`,
			['required']
		],
		[
			'classifications',
			`SELECT * FROM ${owner}_classifications WHERE ${within}
			 ORDER BY ${ownerId}, kind, normalized_value, locale`,
			[]
		],
		['media', `SELECT * FROM ${owner}_media WHERE ${within} ORDER BY ${ownerId}, position`, []],
		[
			'nutritionFacts',
			`SELECT * FROM ${owner}_nutrition_facts WHERE ${within}
			 ORDER BY ${ownerId}, schema_org_property`,
			[]
		]
	] as const;
};

/** Reads the seven sidecar collections of many recipes or meals in seven statements. */
export const readSidecars = async (
	database: D1Database,
	owner: 'recipe' | 'meal',
	ownerIds: readonly string[]
): Promise<Map<string, Record<string, unknown[]>>> => {
	const reads = sidecarReads(owner);
	const ownerId = `${owner}_id`;
	const ids = JSON.stringify(ownerIds);
	const results = await Promise.all(reads.map(([, sql]) => queryAll(database, sql, ids)));
	const sidecars = new Map<string, Record<string, unknown[]>>(
		ownerIds.map((id) => [id, Object.fromEntries(reads.map(([property]) => [property, []]))])
	);
	reads.forEach(([property, , booleans], index) => {
		for (const row of results[index]!) {
			const record = camelize(row, [ownerId]);
			for (const key of booleans) if (key in record) record[key] = record[key] === 1;
			sidecars.get(String(row[ownerId]))?.[property]!.push(record);
		}
	});
	return sidecars;
};
