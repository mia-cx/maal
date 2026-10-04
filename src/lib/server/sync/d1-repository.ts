import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { isRecipeAggregate, type StoredRecipe } from '$lib/domain/recipes/schema.js';
import {
	USER_SYNC_ENTITY_KINDS,
	type MutationReceipt,
	type SyncChange,
	type SyncMutation,
	type UserSyncEntityKind
} from '$lib/sync/contracts.js';
import { decodeUserSyncAggregate } from '$lib/sync/user-entities.js';
import { pruneSyncRetentionBatch } from '$lib/server/maintenance/sync-retention.js';

import {
	COMMIT_RACED,
	JSON_IDENTITIES,
	JSON_IDS,
	MAX_COMMIT_ATTEMPTS,
	assertIdentifier,
	camelize,
	entityHeadSql,
	groupBy,
	heldManifestKeys,
	identitiesJson,
	kindLiteral,
	listHeldIdentities,
	queryAll,
	readSidecars,
	type CommitResult,
	type EntityIdentity,
	type SqlValue
} from './d1-snapshot.js';
import { ServerSyncUnavailable } from './errors.js';
import { incomingWinsHistoricalConflict, type WinningClock } from './reconciliation.js';
import {
	syncEntityKey,
	type ServerBootstrapPage,
	type ServerBootstrapPageRequest,
	type ServerSyncPage,
	type ServerSyncScopeState,
	type UserSyncRepository
} from './repository.js';

interface ScopeRow {
	bootstrap_generation: number;
	earliest_retained_sequence: number;
	latest_sequence: number;
}

interface ChangeRow {
	seq: number;
	mutation_id: string;
	origin_device_id: string;
	entity_kind: string;
	entity_id: string;
	conflict_group: string;
	operation: 'upsert' | 'delete';
	resulting_revision: number;
	occurred_at: string;
	received_at: string;
	payload: string;
	tombstone_expires_at: string | null;
}

interface ReceiptRow {
	mutation_id: string;
	status: 'accepted' | 'rejected';
	sequence: number | null;
	resulting_revision: number | null;
	error_code: string | null;
}

interface ActiveTombstoneRow {
	payload: string;
}

interface VersionRow {
	conflict_group: string;
	revision: number;
	last_sequence: number;
	winning_occurred_at: string;
	winning_origin_device_id: string;
	winning_mutation_id: string;
	winning_actor_user_id: string | null;
	winning_received_at: string | null;
}

interface StoredChangePayload {
	schemaVersion: 1;
	payload: { conflictGroups: string[]; aggregate: unknown };
}

const USER_TABLES = {
	foodUserAlias: 'food_user_aliases',
	foodUserEntry: 'food_user_entries',
	unitUserAlias: 'unit_user_aliases',
	unitUserEntry: 'unit_user_entries',
	userFoodPreference: 'user_food_preferences',
	userFoodDisplayPreference: 'user_food_display_overrides',
	userUnitDisplayPreference: 'user_unit_display_overrides'
} as const;

const USER_TABLE_COLUMNS = {
	foodUserAlias: [
		'id',
		'workosUserId',
		'foodId',
		'alias',
		'locale',
		'sourceDomain',
		'adoptionStatus',
		'defaultMeasureUnitId',
		'defaultMeasureBaseUnitId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	foodUserEntry: [
		'id',
		'workosUserId',
		'canonicalLabel',
		'defaultMeasureUnitId',
		'defaultMeasureBaseUnitId',
		'adoptionStatus',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	unitUserAlias: [
		'id',
		'workosUserId',
		'unitId',
		'baseUnitId',
		'alias',
		'pluralAlias',
		'locale',
		'sourceDomain',
		'adoptionStatus',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	unitUserEntry: [
		'id',
		'workosUserId',
		'canonicalLabel',
		'baseUnitId',
		'toBaseFactor',
		'toBaseOffset',
		'adoptionStatus',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	userFoodPreference: [
		'id',
		'workosUserId',
		'foodId',
		'preference',
		'reason',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	userFoodDisplayPreference: [
		'id',
		'workosUserId',
		'preferredFoodAliasScope',
		'foodId',
		'locale',
		'preferredFoodAliasId',
		'preferredMeasureUnitId',
		'preferredMeasureBaseUnitId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	userUnitDisplayPreference: [
		'id',
		'workosUserId',
		'preferredUnitAliasScope',
		'baseUnitId',
		'locale',
		'preferredUnitId',
		'preferredUnitAliasId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	]
} as const satisfies Record<keyof typeof USER_TABLES, readonly string[]>;

const RECIPE_PARENT_COLUMNS = [
	'id',
	'ownerUserId',
	'savedFromHouseholdId',
	'title',
	'description',
	'imageUrl',
	'prepTimeMinutes',
	'cookTimeMinutes',
	'totalTimeMinutes',
	'yield',
	'sourceYieldText',
	'sourceDatePublished',
	'sourceDateModified',
	'sourceLanguage',
	'sourceUrl',
	'sourceSiteName',
	'sourceAuthorName',
	'sourcePublisherName',
	'sourceIsBasedOnUrl',
	'sourceImportedAt',
	'sourceHtmlHash',
	'sourceRatingValue',
	'sourceRatingCount',
	'sourceReviewCount',
	'sourceClaimedMinutes',
	'parseConfidence',
	'ingredientConfidence',
	'instructionConfidence',
	'nutritionConfidence',
	'userNotes',
	'schemaVersion',
	'revision',
	'createdAt',
	'updatedAt',
	'deletedAt'
] as const;

const SIDE_CARS = [
	['ingredients', 'recipe_ingredients', 'recipeId'],
	['instructions', 'recipe_instructions', 'recipeId'],
	['instructionEvents', 'recipe_instruction_events', null],
	['applianceRequirements', 'recipe_appliance_requirements', 'recipeId'],
	['classifications', 'recipe_classifications', 'recipeId'],
	['media', 'recipe_media', 'recipeId'],
	['nutritionFacts', 'recipe_nutrition_facts', 'recipeId']
] as const;

const camelToSnake = (value: string): string =>
	value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const sqlValue = (value: unknown): SqlValue => {
	if (value === undefined) return null;
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		value instanceof ArrayBuffer
	)
		return value;
	if (typeof value === 'boolean') return value ? 1 : 0;
	throw new TypeError('A normalized D1 column received a non-scalar value.');
};

const pickSnake = (
	source: Record<string, unknown>,
	keys: readonly string[]
): Record<string, SqlValue> =>
	Object.fromEntries(keys.map((key) => [camelToSnake(key), sqlValue(source[key])])) as Record<
		string,
		SqlValue
	>;

const upsert = (
	database: D1Database,
	table: string,
	row: Record<string, SqlValue>,
	conflictColumns: readonly string[] = ['id']
): D1PreparedStatement => {
	const columns = Object.keys(row);
	const updates = columns.filter((column) => !conflictColumns.includes(column));
	const sql = `INSERT INTO ${assertIdentifier(table)} (${columns.map(assertIdentifier).join(', ')})
		VALUES (${columns.map(() => '?').join(', ')})
		ON CONFLICT (${conflictColumns.map(assertIdentifier).join(', ')}) DO UPDATE SET
		${updates.map((column) => `${assertIdentifier(column)} = excluded.${assertIdentifier(column)}`).join(', ')}`;
	return database.prepare(sql).bind(...columns.map((column) => row[column]!));
};

const decodeStoredPayload = (encoded: string): StoredChangePayload => {
	const value: unknown = JSON.parse(encoded);
	if (
		typeof value !== 'object' ||
		value === null ||
		(value as { schemaVersion?: unknown }).schemaVersion !== CURRENT_SCHEMA_VERSION
	)
		throw new TypeError('Unsupported persisted sync payload.');
	const payload = (value as { payload?: unknown }).payload;
	if (typeof payload !== 'object' || payload === null)
		throw new TypeError('Malformed persisted sync payload.');
	const candidate = payload as { conflictGroups?: unknown; aggregate?: unknown };
	if (
		!Array.isArray(candidate.conflictGroups) ||
		!candidate.conflictGroups.every((group) => typeof group === 'string')
	) {
		throw new TypeError('Malformed persisted conflict groups.');
	}
	return {
		schemaVersion: 1,
		payload: { conflictGroups: candidate.conflictGroups, aggregate: candidate.aggregate }
	};
};

const changeFromRow = (row: ChangeRow): SyncChange => {
	const stored = decodeStoredPayload(row.payload);
	return {
		sequence: row.seq,
		mutationId: row.mutation_id,
		originDeviceId: row.origin_device_id,
		entityKind: row.entity_kind as UserSyncEntityKind,
		entityId: row.entity_id,
		conflictGroups: stored.payload.conflictGroups as [string, ...string[]],
		operation: row.operation,
		resultingRevision: row.resulting_revision,
		occurredAt: row.occurred_at as `${string}Z`,
		receivedAt: row.received_at as `${string}Z`,
		aggregate: stored.payload.aggregate,
		tombstoneExpiresAt: row.tombstone_expires_at as `${string}Z` | null
	};
};

const receiptFromRow = (row: ReceiptRow, duplicate = false): MutationReceipt => {
	if (row.status === 'accepted' && row.sequence !== null && row.resulting_revision !== null) {
		return {
			mutationId: row.mutation_id,
			status: duplicate ? 'duplicate' : 'accepted',
			sequence: row.sequence,
			resultingRevision: row.resulting_revision
		};
	}
	return {
		mutationId: row.mutation_id,
		status: 'rejected',
		sequence: null,
		resultingRevision: null,
		errorCode: row.error_code ?? 'rejected'
	};
};

const rejectMutation = async (
	database: D1Database,
	workosUserId: string,
	mutation: SyncMutation,
	receivedAt: string,
	errorCode: string
): Promise<MutationReceipt> => {
	const retainUntil = new Date(Date.parse(receivedAt) + 365 * 86_400_000).toISOString();
	await database
		.prepare(
			`INSERT INTO sync_mutation_receipts
			 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
			  resulting_revision, error_code, created_at, retain_until)
			 VALUES (?, 'user', ?, ?, ?, 'rejected', NULL, NULL, ?, ?, ?)`
		)
		.bind(
			mutation.mutationId,
			workosUserId,
			mutation.entityKind,
			mutation.entityId,
			errorCode,
			receivedAt,
			retainUntil
		)
		.run();
	return {
		mutationId: mutation.mutationId,
		status: 'rejected',
		sequence: null,
		resultingRevision: null,
		errorCode
	};
};

const mergeRecipe = (
	currentInput: unknown | null,
	incomingInput: unknown,
	acceptedGroups: readonly string[],
	revision: number,
	clock: WinningClock
): unknown => {
	const incoming = incomingInput as StoredRecipe;
	const current = currentInput as StoredRecipe | null;
	if (current === null || !isRecipeAggregate(current) || !isRecipeAggregate(incoming)) {
		return { ...incoming, revision, updatedAt: clock.occurredAt };
	}
	const next: Record<string, unknown> = { ...current };
	const incomingRecord: Record<string, unknown> = { ...incoming };
	const header = [
		'savedFromHouseholdId',
		'title',
		'description',
		'imageUrl',
		'prepTimeMinutes',
		'cookTimeMinutes',
		'totalTimeMinutes',
		'yield',
		'sourceYieldText',
		'sourceClaimedMinutes',
		'sourceDatePublished',
		'sourceDateModified',
		'sourceLanguage',
		'sourceUrl',
		'sourceSiteName',
		'sourceAuthorName',
		'sourcePublisherName',
		'sourceIsBasedOnUrl',
		'sourceImportedAt',
		'sourceHtmlHash',
		'sourceRatingValue',
		'sourceRatingCount',
		'sourceReviewCount',
		'parseConfidence',
		'ingredientConfidence',
		'instructionConfidence',
		'nutritionConfidence',
		'userNotes',
		'searchTokens'
	];
	const groupFields: Record<string, readonly string[]> = {
		header,
		ingredients: ['ingredients'],
		instructions: ['instructions', 'instructionEvents'],
		appliances: ['applianceRequirements'],
		classifications: ['classifications'],
		media: ['media'],
		nutrition: ['nutritionFacts'],
		deletion: ['deletedAt']
	};
	for (const group of acceptedGroups) {
		for (const field of groupFields[group] ?? header) next[field] = incomingRecord[field];
	}
	const clocks = { ...current.conflictClocks };
	for (const group of acceptedGroups) clocks[group] = clock;
	return { ...next, revision, updatedAt: clock.occurredAt, conflictClocks: clocks };
};

const normalizedStatements = (
	database: D1Database,
	entityKind: UserSyncEntityKind,
	aggregate: Record<string, unknown>
): D1PreparedStatement[] => {
	if (entityKind !== 'recipe') {
		const table = USER_TABLES[entityKind];
		const columns = USER_TABLE_COLUMNS[entityKind];
		return [upsert(database, table, pickSnake(aggregate, columns))];
	}
	if ('purgedAt' in aggregate) {
		return [database.prepare('DELETE FROM recipes WHERE id = ?').bind(String(aggregate.id))];
	}
	const recipeId = String(aggregate.id);
	const statements = [upsert(database, 'recipes', pickSnake(aggregate, RECIPE_PARENT_COLUMNS))];
	statements.push(
		database
			.prepare(
				'DELETE FROM recipe_instruction_events WHERE recipe_instruction_id IN (SELECT id FROM recipe_instructions WHERE recipe_id = ?)'
			)
			.bind(recipeId),
		database.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(recipeId),
		database.prepare('DELETE FROM recipe_instructions WHERE recipe_id = ?').bind(recipeId),
		database
			.prepare('DELETE FROM recipe_appliance_requirements WHERE recipe_id = ?')
			.bind(recipeId),
		database.prepare('DELETE FROM recipe_classifications WHERE recipe_id = ?').bind(recipeId),
		database.prepare('DELETE FROM recipe_media WHERE recipe_id = ?').bind(recipeId),
		database.prepare('DELETE FROM recipe_nutrition_facts WHERE recipe_id = ?').bind(recipeId)
	);
	for (const [property, table, ownerKey] of SIDE_CARS) {
		const records = aggregate[property];
		if (!Array.isArray(records)) continue;
		for (const input of records) {
			const source = input as Record<string, unknown>;
			const row = Object.fromEntries(
				Object.entries(source).map(([key, value]) => [camelToSnake(key), sqlValue(value)])
			) as Record<string, SqlValue>;
			if (ownerKey) row[camelToSnake(ownerKey)] = recipeId;
			statements.push(upsert(database, table, row));
		}
	}
	return statements;
};

const scopeState = async (
	database: D1Database,
	workosUserId: string
): Promise<ServerSyncScopeState> => {
	const row = await database
		.prepare(
			`SELECT bootstrap_generation, earliest_retained_sequence, latest_sequence
		 FROM sync_scope_state WHERE audience_kind = 'user' AND audience_id = ?`
		)
		.bind(workosUserId)
		.first<ScopeRow>();
	return row
		? {
				retainedFloor: row.earliest_retained_sequence,
				latestSequence: row.latest_sequence,
				bootstrapGeneration: row.bootstrap_generation
			}
		: { retainedFloor: 0, latestSequence: 0, bootstrapGeneration: 1 };
};

const readVersions = async (
	database: D1Database,
	workosUserId: string,
	entityKind: UserSyncEntityKind,
	entityId: string
): Promise<VersionRow[]> =>
	(
		await database
			.prepare(
				`SELECT conflict_group, revision, last_sequence, winning_occurred_at,
	        winning_origin_device_id, winning_mutation_id, winning_actor_user_id, winning_received_at
	 FROM sync_entity_versions
	 WHERE audience_kind = 'user' AND audience_id = ? AND entity_kind = ? AND entity_id = ?`
			)
			.bind(workosUserId, entityKind, entityId)
			.all<VersionRow>()
	).results;

const readLatestChangedAggregate = async (
	database: D1Database,
	workosUserId: string,
	entityKind: UserSyncEntityKind,
	entityId: string
): Promise<unknown | null> => {
	const row = await database
		.prepare(
			`SELECT payload FROM sync_changes
		 WHERE audience_kind = 'user' AND audience_id = ? AND entity_kind = ? AND entity_id = ?
		 ORDER BY seq DESC LIMIT 1`
		)
		.bind(workosUserId, entityKind, entityId)
		.first<{ payload: string }>();
	return row ? decodeStoredPayload(row.payload).payload.aggregate : null;
};

const conflictClocks = (versions: readonly VersionRow[]) =>
	Object.fromEntries(
		versions.map((version) => [
			version.conflict_group,
			{
				occurredAt: version.winning_occurred_at,
				originDeviceId: version.winning_origin_device_id,
				mutationId: version.winning_mutation_id
			}
		])
	);

/** The normalized table and owner column that hold a user entity kind's current row. */
const entityTable = (kind: UserSyncEntityKind): readonly [table: string, owner: string] =>
	kind === 'recipe' ? ['recipes', 'owner_user_id'] : [USER_TABLES[kind], 'workos_user_id'];

export type UserEntityIdentity = EntityIdentity<UserSyncEntityKind>;

const audience = (workosUserId: string) => ({ kind: 'user' as const, id: workosUserId });

/**
 * SQL that is true when the user still holds a readable aggregate for the version row `v`: a
 * normalized row, a retained recipe change, or a tombstone change. `?1` must bind the user ID.
 */
const HELD_ENTITY_SQL = `(
	CASE v.entity_kind ${USER_SYNC_ENTITY_KINDS.map((kind) => {
		const [table, owner] = entityTable(kind);
		return `WHEN ${kindLiteral(kind)} THEN EXISTS (SELECT 1 FROM ${assertIdentifier(table)} r
			WHERE r.id = v.entity_id AND r.${assertIdentifier(owner)} = ?1)`;
	}).join(' ')} ELSE 0 END
	OR (v.entity_kind = 'recipe' AND EXISTS (SELECT 1 FROM sync_changes c
		WHERE c.audience_kind = 'user' AND c.audience_id = ?1
		AND c.entity_kind = v.entity_kind AND c.entity_id = v.entity_id))
	OR EXISTS (SELECT 1 FROM sync_tombstones t JOIN sync_changes c ON c.seq = t.deletion_sequence
		WHERE t.audience_kind = 'user' AND t.audience_id = ?1
		AND t.entity_kind = v.entity_kind AND t.entity_id = v.entity_id)
)`;

/**
 * Reads the current snapshot change for each held identity in a fixed number of statements:
 * versions, one row query per kind, the recipe sidecars, and fallbacks for rows that are gone.
 * Identities the user does not hold are left out. Results keep the input order.
 */
const readSnapshotChanges = async (
	database: D1Database,
	workosUserId: string,
	identities: readonly UserEntityIdentity[]
): Promise<SyncChange[]> => {
	if (identities.length === 0) return [];
	const idsByKind = groupBy(identities, ({ entityKind }) => entityKind);
	const recipeIds = idsByKind.get('recipe')?.map(({ entityId }) => entityId) ?? [];
	const [versionRows, rowGroups, sidecars] = await Promise.all([
		queryAll<VersionRow & { entity_kind: UserSyncEntityKind; entity_id: string }>(
			database,
			`SELECT entity_kind, entity_id, conflict_group, revision, last_sequence, winning_occurred_at,
			 winning_origin_device_id, winning_mutation_id, winning_actor_user_id, winning_received_at
			 FROM sync_entity_versions
			 WHERE audience_kind = 'user' AND audience_id = ?
			 AND (entity_kind, entity_id) IN (${JSON_IDENTITIES})`,
			workosUserId,
			identitiesJson(identities)
		),
		Promise.all(
			[...idsByKind.entries()].map(async ([kind, group]) => {
				const [table, owner] = entityTable(kind as UserSyncEntityKind);
				const rows = await queryAll(
					database,
					`SELECT * FROM ${assertIdentifier(table)}
					 WHERE ${assertIdentifier(owner)} = ? AND id IN (${JSON_IDS})`,
					workosUserId,
					JSON.stringify(group.map(({ entityId }) => entityId))
				);
				return rows.map((row) => ({
					key: syncEntityKey(kind as UserSyncEntityKind, String(row.id)),
					row
				}));
			})
		),
		recipeIds.length > 0 ? readSidecars(database, 'recipe', recipeIds) : new Map()
	]);
	const versionsByKey = groupBy(versionRows, (row) =>
		syncEntityKey(row.entity_kind, row.entity_id)
	);
	const rowsByKey = new Map(rowGroups.flat().map(({ key, row }) => [key, row]));
	const missing = identities.filter(
		({ entityKind, entityId }) => !rowsByKey.has(syncEntityKey(entityKind, entityId))
	);
	const missingRecipes = missing.filter(({ entityKind }) => entityKind === 'recipe');
	const [latestRecipeRows, tombstoneRows] =
		missing.length === 0
			? [[], []]
			: await Promise.all([
					missingRecipes.length === 0
						? []
						: queryAll<{ entity_id: string; payload: string }>(
								database,
								`SELECT entity_id, payload, MAX(seq) AS seq FROM sync_changes
								 WHERE audience_kind = 'user' AND audience_id = ? AND entity_kind = 'recipe'
								 AND entity_id IN (${JSON_IDS})
								 GROUP BY entity_id`,
								workosUserId,
								JSON.stringify(missingRecipes.map(({ entityId }) => entityId))
							),
					queryAll<ChangeRow>(
						database,
						`SELECT c.* FROM sync_tombstones t
						 JOIN sync_changes c ON c.seq = t.deletion_sequence
						 WHERE t.audience_kind = 'user' AND t.audience_id = ?
						 AND (t.entity_kind, t.entity_id) IN (${JSON_IDENTITIES})`,
						workosUserId,
						identitiesJson(missing)
					)
				]);
	const latestRecipes = new Map(
		latestRecipeRows.map((row) => [
			syncEntityKey('recipe', row.entity_id),
			decodeStoredPayload(row.payload).payload.aggregate
		])
	);
	const tombstones = new Map(
		tombstoneRows.map((row) => [
			syncEntityKey(row.entity_kind as UserSyncEntityKind, row.entity_id),
			changeFromRow(row)
		])
	);

	const changes: SyncChange[] = [];
	for (const { entityKind, entityId } of identities) {
		const key = syncEntityKey(entityKind, entityId);
		const versions = versionsByKey.get(key);
		const row = rowsByKey.get(key);
		if (versions && row) {
			const clocks = conflictClocks(versions);
			changes.push(
				syntheticChange(
					entityKind,
					entityId,
					entityKind === 'recipe'
						? {
								...camelize(row),
								conflictClocks: clocks,
								searchTokens: [],
								...sidecars.get(entityId)
							}
						: { ...camelize(row), conflictClocks: clocks },
					versions
				)
			);
		} else if (versions && latestRecipes.has(key)) {
			changes.push(syntheticChange(entityKind, entityId, latestRecipes.get(key), versions));
		} else if (tombstones.has(key)) {
			changes.push(tombstones.get(key)!);
		}
	}
	return changes;
};

const syntheticChange = (
	entityKind: UserSyncEntityKind,
	entityId: string,
	aggregate: unknown,
	versions: readonly VersionRow[]
): SyncChange => {
	const winner = versions.toSorted((left, right) => right.last_sequence - left.last_sequence)[0]!;
	const record = aggregate as { deletedAt?: string | null };
	return {
		sequence: winner.last_sequence,
		mutationId: winner.winning_mutation_id,
		originDeviceId: winner.winning_origin_device_id,
		entityKind,
		entityId,
		conflictGroups: versions.map(({ conflict_group }) => conflict_group) as [string, ...string[]],
		operation: record.deletedAt ? 'delete' : 'upsert',
		resultingRevision: Math.max(...versions.map(({ revision }) => revision)),
		occurredAt: winner.winning_occurred_at as `${string}Z`,
		receivedAt: (winner.winning_received_at ?? winner.winning_occurred_at) as `${string}Z`,
		aggregate,
		tombstoneExpiresAt: null
	};
};

const ENTITY_HEAD_SQL = entityHeadSql('user');

type UserCommitInput = Parameters<UserSyncRepository['commit']>[0];

export class D1UserSyncRepository implements UserSyncRepository {
	constructor(private readonly database: D1Database) {}

	readScopeState(workosUserId: string) {
		return scopeState(this.database, workosUserId);
	}

	async pull(workosUserId: string, after: number, limit: number): Promise<ServerSyncPage> {
		const state = await scopeState(this.database, workosUserId);
		const rows = (
			await this.database
				.prepare(
					`SELECT * FROM sync_changes
			 WHERE audience_kind = 'user' AND audience_id = ? AND seq > ?
			 ORDER BY seq LIMIT ?`
				)
				.bind(workosUserId, after, limit + 1)
				.all<ChangeRow>()
		).results;
		const hasMore = rows.length > limit;
		const selected = rows.slice(0, limit);
		return {
			...state,
			changes: selected.map(changeFromRow),
			throughSequence: selected.at(-1)?.seq ?? Math.min(after, state.latestSequence),
			hasMore
		};
	}

	/** Reads the held aggregates for these identities, in input order, at a fixed statement cost. */
	readEntities(workosUserId: string, identities: readonly UserEntityIdentity[]) {
		return readSnapshotChanges(this.database, workosUserId, identities);
	}

	/** Reads every held aggregate of these kinds, in entity-key order. */
	async readEntitiesOfKinds(workosUserId: string, kinds: readonly UserSyncEntityKind[]) {
		const identities = await listHeldIdentities(
			this.database,
			audience(workosUserId),
			HELD_ENTITY_SQL,
			{ kinds }
		);
		return readSnapshotChanges(this.database, workosUserId, identities);
	}

	async bootstrap(
		workosUserId: string,
		page: ServerBootstrapPageRequest
	): Promise<ServerBootstrapPage> {
		// Read the watermark before the listing: a commit landing between them then
		// appears on the page instead of being skipped above throughSequence.
		const state = await scopeState(this.database, workosUserId);
		const identities = await listHeldIdentities<UserSyncEntityKind>(
			this.database,
			audience(workosUserId),
			HELD_ENTITY_SQL,
			{ afterEntityKey: page.afterEntityKey, limit: page.limit + 1 }
		);
		const authoritativeIds = await heldManifestKeys(
			this.database,
			audience(workosUserId),
			HELD_ENTITY_SQL,
			page.manifest
		);
		const selected = identities.slice(0, page.limit);
		const last = selected.at(-1);
		return {
			...state,
			aggregates: await readSnapshotChanges(this.database, workosUserId, selected),
			authoritativeIds,
			nextEntityKey:
				identities.length > page.limit && last
					? syncEntityKey(last.entityKind, last.entityId)
					: null
		};
	}

	async commit(input: UserCommitInput): Promise<MutationReceipt> {
		return (await this.commitWithResult(input)).receipt;
	}

	/**
	 * Commits one mutation and returns the aggregate it stored. The merge base is read before the
	 * write batch, so the batch only applies while the entity head is unchanged; a concurrent
	 * commit makes it retry against the new head instead of overwriting the other edit.
	 */
	async commitWithResult(input: UserCommitInput): Promise<CommitResult> {
		for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
			const result = await this.attemptCommit(input);
			if (result !== COMMIT_RACED) return result;
		}
		throw new ServerSyncUnavailable({
			code: 'commit_contention',
			message: 'The entity kept changing while this mutation was committed.'
		});
	}

	/** True when another commit moved the entity head or stored this mutation first. */
	private async raced(input: UserCommitInput, head: number): Promise<boolean> {
		const row = await this.database
			.prepare(
				`SELECT ${ENTITY_HEAD_SQL} AS head,
				 EXISTS (SELECT 1 FROM sync_mutation_receipts WHERE mutation_id = ?) AS stored`
			)
			.bind(
				input.actorUserId,
				input.mutation.entityKind,
				input.mutation.entityId,
				input.mutation.mutationId
			)
			.first<{ head: number; stored: number }>();
		return row !== null && (row.head !== head || row.stored === 1);
	}

	private async attemptCommit(input: UserCommitInput): Promise<CommitResult | typeof COMMIT_RACED> {
		const existingReceipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (existingReceipt) {
			const receipt = receiptFromRow(existingReceipt, true);
			// A batch that committed but threw retries here; the write did land, so
			// return the stored aggregate instead of null.
			const aggregate =
				receipt.status === 'accepted' || receipt.status === 'duplicate'
					? ((await readLatestChangedAggregate(
							this.database,
							input.actorUserId,
							input.mutation.entityKind,
							input.mutation.entityId
						)) ??
						(
							await readSnapshotChanges(this.database, input.actorUserId, [
								{
									entityKind: input.mutation.entityKind,
									entityId: input.mutation.entityId
								}
							])
						)[0]?.aggregate)
					: null;
			return { receipt, aggregate: aggregate ?? null };
		}
		const rejected = async (code: string) => ({
			receipt: await rejectMutation(
				this.database,
				input.actorUserId,
				input.mutation,
				input.receivedAt,
				code
			),
			aggregate: null
		});

		const decodedIncoming = decodeUserSyncAggregate(
			input.mutation.entityKind,
			input.mutation.entityId,
			input.actorUserId,
			input.mutation.aggregate
		);
		const activeTombstone = await this.database
			.prepare(
				`SELECT c.payload FROM sync_tombstones t
				 JOIN sync_changes c ON c.seq = t.deletion_sequence
				 WHERE t.audience_kind = 'user' AND t.audience_id = ? AND t.entity_kind = ?
				  AND t.entity_id = ? AND t.expires_at > ?`
			)
			.bind(input.actorUserId, input.mutation.entityKind, input.mutation.entityId, input.receivedAt)
			.first<ActiveTombstoneRow>();
		if (activeTombstone && input.mutation.operation === 'upsert') {
			const deletedAggregate = decodeStoredPayload(activeTombstone.payload).payload.aggregate;
			const intentionalSoftDeleteRestore =
				input.mode === 'live' &&
				input.mutation.entityKind === 'recipe' &&
				input.mutation.conflictGroups.length === 1 &&
				input.mutation.conflictGroups[0] === 'deletion' &&
				isRecipeAggregate(deletedAggregate as StoredRecipe) &&
				isRecipeAggregate(decodedIncoming.aggregate as StoredRecipe) &&
				decodedIncoming.aggregate.deletedAt === null;
			if (!intentionalSoftDeleteRestore) return rejected('tombstoned_entity');
		}
		const versions = await readVersions(
			this.database,
			input.actorUserId,
			input.mutation.entityKind,
			input.mutation.entityId
		);
		const versionByGroup = new Map(versions.map((version) => [version.conflict_group, version]));
		const acceptedGroups =
			input.mode === 'live'
				? [...input.mutation.conflictGroups]
				: input.mutation.conflictGroups.filter((group) => {
						const version = versionByGroup.get(group);
						return incomingWinsHistoricalConflict(
							version
								? {
										occurredAt: version.winning_occurred_at,
										originDeviceId: version.winning_origin_device_id,
										mutationId: version.winning_mutation_id
									}
								: null,
							input.mutation
						);
					});
		const receiptRetainUntil = new Date(
			Date.parse(input.receivedAt) + 365 * 86_400_000
		).toISOString();
		if (acceptedGroups.length === 0) return rejected('historical_loser');

		const head = Math.max(0, ...versions.map(({ last_sequence }) => last_sequence));
		const current =
			(await readLatestChangedAggregate(
				this.database,
				input.actorUserId,
				input.mutation.entityKind,
				input.mutation.entityId
			)) ??
			(
				await readSnapshotChanges(this.database, input.actorUserId, [
					{ entityKind: input.mutation.entityKind, entityId: input.mutation.entityId }
				])
			)[0]?.aggregate ??
			null;
		const revision = Math.max(0, ...versions.map(({ revision }) => revision)) + 1;
		const clock = {
			occurredAt: input.mutation.occurredAt,
			originDeviceId: input.mutation.originDeviceId,
			mutationId: input.mutation.mutationId
		};
		const result =
			input.mutation.entityKind === 'recipe'
				? mergeRecipe(current, decodedIncoming.aggregate, acceptedGroups, revision, clock)
				: {
						...decodedIncoming.aggregate,
						revision,
						updatedAt: input.mutation.occurredAt,
						conflictClocks: Object.fromEntries(acceptedGroups.map((group) => [group, clock]))
					};
		const decodedResult = decodeUserSyncAggregate(
			input.mutation.entityKind,
			input.mutation.entityId,
			input.actorUserId,
			result
		);
		const tombstoneExpiresAt =
			input.mutation.operation === 'delete'
				? new Date(Date.parse(input.receivedAt) + 365 * 86_400_000).toISOString()
				: null;
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			payload: { conflictGroups: acceptedGroups, aggregate: decodedResult.aggregate }
		});
		const statements = [
			this.database
				.prepare(
					`INSERT INTO users (workos_user_id, schema_version, revision, created_at, updated_at)
				 VALUES (?, 1, 1, ?, ?) ON CONFLICT(workos_user_id) DO NOTHING`
				)
				.bind(input.actorUserId, input.receivedAt, input.receivedAt),
			...normalizedStatements(this.database, input.mutation.entityKind, decodedResult.aggregate),
			this.database
				.prepare(
					`INSERT INTO sync_changes
				 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
				  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
				  payload, tombstone_expires_at)
				 VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?,
				  CASE WHEN ${ENTITY_HEAD_SQL} = ? THEN ? END, ?)`
				)
				.bind(
					input.mutation.mutationId,
					input.actorUserId,
					input.mutation.originDeviceId,
					input.actorUserId,
					input.mutation.entityKind,
					input.mutation.entityId,
					acceptedGroups.join(','),
					input.mutation.operation,
					revision,
					input.mutation.occurredAt,
					input.receivedAt,
					// A moved head leaves the payload NULL, which fails NOT NULL and rolls the batch back.
					input.actorUserId,
					input.mutation.entityKind,
					input.mutation.entityId,
					head,
					payload,
					tombstoneExpiresAt
				)
		];
		for (const group of acceptedGroups) {
			statements.push(
				this.database
					.prepare(
						`INSERT INTO sync_entity_versions
					 (audience_kind, audience_id, entity_kind, entity_id, conflict_group, revision,
				  last_sequence, winning_occurred_at, winning_origin_device_id, winning_mutation_id,
				  winning_actor_user_id, winning_received_at)
					 VALUES ('user', ?, ?, ?, ?, ?,
				  (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, ?, ?, ?, ?)
					 ON CONFLICT(audience_kind, audience_id, entity_kind, entity_id, conflict_group)
					 DO UPDATE SET revision = excluded.revision, last_sequence = excluded.last_sequence,
					  winning_occurred_at = excluded.winning_occurred_at,
					  winning_origin_device_id = excluded.winning_origin_device_id,
					  winning_mutation_id = excluded.winning_mutation_id,
					  winning_actor_user_id = excluded.winning_actor_user_id,
					  winning_received_at = excluded.winning_received_at`
					)
					.bind(
						input.actorUserId,
						input.mutation.entityKind,
						input.mutation.entityId,
						group,
						revision,
						input.mutation.mutationId,
						input.mutation.occurredAt,
						input.mutation.originDeviceId,
						input.mutation.mutationId,
						input.actorUserId,
						input.receivedAt
					)
			);
		}
		statements.push(
			this.database
				.prepare(
					`INSERT INTO sync_scope_state
				 (audience_kind, audience_id, bootstrap_generation, earliest_retained_sequence,
				  latest_sequence, updated_at)
				 VALUES ('user', ?, 1, 0, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?)
				 ON CONFLICT(audience_kind, audience_id) DO UPDATE SET
				  latest_sequence = excluded.latest_sequence, updated_at = excluded.updated_at`
				)
				.bind(input.actorUserId, input.mutation.mutationId, input.receivedAt),
			this.database
				.prepare(
					`INSERT INTO sync_devices
				 (device_id, workos_user_id, created_at, last_seen_at, last_app_version, last_protocol_version)
				 VALUES (?, ?, ?, ?, 'v1', 1)
				 ON CONFLICT(device_id, workos_user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
				  last_app_version = excluded.last_app_version, last_protocol_version = excluded.last_protocol_version`
				)
				.bind(input.deviceId, input.actorUserId, input.receivedAt, input.receivedAt),
			this.database
				.prepare(
					`INSERT INTO sync_mutation_receipts
				 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
				  resulting_revision, error_code, created_at, retain_until)
				 VALUES (?, 'user', ?, ?, ?, 'accepted',
				  (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, NULL, ?, ?)`
				)
				.bind(
					input.mutation.mutationId,
					input.actorUserId,
					input.mutation.entityKind,
					input.mutation.entityId,
					input.mutation.mutationId,
					revision,
					input.receivedAt,
					receiptRetainUntil
				)
		);
		if (tombstoneExpiresAt) {
			statements.push(
				this.database
					.prepare(
						`INSERT INTO sync_tombstones
				 (audience_kind, audience_id, entity_kind, entity_id, deletion_sequence, deleted_at,
				  expires_at, previous_server_ack)
				 VALUES ('user', ?, ?, ?, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, ?, 1)
				 ON CONFLICT(audience_kind, audience_id, entity_kind, entity_id) DO UPDATE SET
				  deletion_sequence = excluded.deletion_sequence, deleted_at = excluded.deleted_at,
				  expires_at = excluded.expires_at, previous_server_ack = 1`
					)
					.bind(
						input.actorUserId,
						input.mutation.entityKind,
						input.mutation.entityId,
						input.mutation.mutationId,
						input.mutation.occurredAt,
						tombstoneExpiresAt
					)
			);
		} else {
			statements.push(
				this.database
					.prepare(
						`DELETE FROM sync_tombstones WHERE audience_kind = 'user' AND audience_id = ?
				 AND entity_kind = ? AND entity_id = ?`
					)
					.bind(input.actorUserId, input.mutation.entityKind, input.mutation.entityId)
			);
		}
		try {
			await this.database.batch(statements);
		} catch (error) {
			if (await this.raced(input, head)) return COMMIT_RACED;
			throw error;
		}
		const receipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (!receipt) throw new TypeError('The committed mutation has no receipt.');
		return { receipt: receiptFromRow(receipt), aggregate: decodedResult.aggregate };
	}

	async prune(input: { now: string; changeCutoff: string }): Promise<void> {
		await pruneSyncRetentionBatch(this.database, {
			audienceKind: 'user',
			...input
		});
	}
}
