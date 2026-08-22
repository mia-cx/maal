import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { isRecipeAggregate, type StoredRecipe } from '$lib/domain/recipes/schema.js';
import type {
	MutationReceipt,
	SyncChange,
	SyncMutation,
	UserSyncEntityKind
} from '$lib/sync/contracts.js';
import { decodeUserSyncAggregate } from '$lib/sync/user-entities.js';
import { pruneSyncRetentionBatch } from '$lib/server/maintenance/sync-retention.js';

import { incomingWinsHistoricalConflict, type WinningClock } from './reconciliation.js';
import {
	syncEntityKey,
	type ServerBootstrapSnapshot,
	type ServerSyncPage,
	type ServerSyncScopeState,
	type UserSyncRepository
} from './repository.js';

type SqlValue = string | number | null | ArrayBuffer;

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
const snakeToCamel = (value: string): string =>
	value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const assertIdentifier = (value: string): string => {
	if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new TypeError('Unsafe SQL identifier.');
	return `"${value}"`;
};

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

const camelize = (
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
	        winning_origin_device_id, winning_mutation_id
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

const readNormalizedAggregate = async (
	database: D1Database,
	workosUserId: string,
	entityKind: UserSyncEntityKind,
	entityId: string
): Promise<unknown | null> => {
	const versions = await readVersions(database, workosUserId, entityKind, entityId);
	if (entityKind !== 'recipe') {
		const table = USER_TABLES[entityKind];
		const row = await database
			.prepare(`SELECT * FROM ${assertIdentifier(table)} WHERE id = ? AND workos_user_id = ?`)
			.bind(entityId, workosUserId)
			.first<Record<string, unknown>>();
		return row ? { ...camelize(row), conflictClocks: conflictClocks(versions) } : null;
	}
	const row = await database
		.prepare('SELECT * FROM recipes WHERE id = ? AND owner_user_id = ?')
		.bind(entityId, workosUserId)
		.first<Record<string, unknown>>();
	if (!row) return readLatestChangedAggregate(database, workosUserId, entityKind, entityId);
	const query = async (sql: string, ...values: SqlValue[]) =>
		(
			await database
				.prepare(sql)
				.bind(...values)
				.all<Record<string, unknown>>()
		).results;
	const [
		ingredients,
		instructions,
		instructionEvents,
		applianceRequirements,
		classifications,
		media,
		nutritionFacts
	] = await Promise.all([
		query('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY line_index', entityId),
		query('SELECT * FROM recipe_instructions WHERE recipe_id = ? ORDER BY step_index', entityId),
		query(
			'SELECT e.* FROM recipe_instruction_events e JOIN recipe_instructions i ON i.id = e.recipe_instruction_id WHERE i.recipe_id = ?',
			entityId
		),
		query('SELECT * FROM recipe_appliance_requirements WHERE recipe_id = ?', entityId),
		query('SELECT * FROM recipe_classifications WHERE recipe_id = ?', entityId),
		query('SELECT * FROM recipe_media WHERE recipe_id = ? ORDER BY position', entityId),
		query('SELECT * FROM recipe_nutrition_facts WHERE recipe_id = ?', entityId)
	]);
	const booleanize = (record: Record<string, unknown>, keys: readonly string[]) => {
		const result = camelize(record, ['recipe_id']);
		for (const key of keys) if (key in result) result[key] = result[key] === 1;
		return result;
	};
	return {
		...camelize(row),
		conflictClocks: conflictClocks(versions),
		searchTokens: [],
		ingredients: ingredients.map((item) => booleanize(item, ['optional'])),
		instructions: instructions.map((item) => camelize(item, ['recipe_id'])),
		instructionEvents: instructionEvents.map((item) => camelize(item)),
		applianceRequirements: applianceRequirements.map((item) => booleanize(item, ['required'])),
		classifications: classifications.map((item) => camelize(item, ['recipe_id'])),
		media: media.map((item) => camelize(item, ['recipe_id'])),
		nutritionFacts: nutritionFacts.map((item) => camelize(item, ['recipe_id']))
	};
};

const syntheticChange = async (
	database: D1Database,
	workosUserId: string,
	entityKind: UserSyncEntityKind,
	entityId: string,
	aggregate: unknown
): Promise<SyncChange | null> => {
	const versions = await readVersions(database, workosUserId, entityKind, entityId);
	const winner = versions.toSorted((left, right) => right.last_sequence - left.last_sequence)[0];
	if (!winner) return null;
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
		receivedAt: winner.winning_occurred_at as `${string}Z`,
		aggregate,
		tombstoneExpiresAt: null
	};
};

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

	async bootstrap(workosUserId: string): Promise<ServerBootstrapSnapshot> {
		const state = await scopeState(this.database, workosUserId);
		const aggregates: SyncChange[] = [];
		const authoritativeIds = new Set<string>();
		const kinds: readonly UserSyncEntityKind[] = [
			'recipe',
			...(Object.keys(USER_TABLES) as (keyof typeof USER_TABLES)[])
		];
		for (const entityKind of kinds) {
			const table = entityKind === 'recipe' ? 'recipes' : USER_TABLES[entityKind];
			const ownerColumn = entityKind === 'recipe' ? 'owner_user_id' : 'workos_user_id';
			const ids = (
				await this.database
					.prepare(
						`SELECT id FROM ${assertIdentifier(table)} WHERE ${assertIdentifier(ownerColumn)} = ?`
					)
					.bind(workosUserId)
					.all<{ id: string }>()
			).results;
			for (const { id } of ids) {
				const aggregate = await readNormalizedAggregate(
					this.database,
					workosUserId,
					entityKind,
					id
				);
				if (aggregate === null) continue;
				const change = await syntheticChange(
					this.database,
					workosUserId,
					entityKind,
					id,
					aggregate
				);
				if (!change) continue;
				aggregates.push(change);
				authoritativeIds.add(syncEntityKey(entityKind, id));
			}
		}
		const tombstones = (
			await this.database
				.prepare(
					`SELECT c.* FROM sync_changes c
			 JOIN sync_tombstones t ON t.audience_kind = c.audience_kind AND t.audience_id = c.audience_id
			   AND t.entity_kind = c.entity_kind AND t.entity_id = c.entity_id
			 WHERE c.audience_kind = 'user' AND c.audience_id = ? AND c.seq = t.deletion_sequence`
				)
				.bind(workosUserId)
				.all<ChangeRow>()
		).results;
		for (const row of tombstones) {
			const change = changeFromRow(row);
			const key = syncEntityKey(change.entityKind, change.entityId);
			if (!authoritativeIds.has(key)) {
				aggregates.push(change);
				authoritativeIds.add(key);
			}
		}
		aggregates.sort((left, right) => left.sequence - right.sequence);
		return { ...state, aggregates, authoritativeIds };
	}

	async commit(input: {
		actorUserId: string;
		deviceId: string;
		mutation: SyncMutation;
		mode: 'live' | 'backfill';
		receivedAt: string;
	}): Promise<MutationReceipt> {
		const existingReceipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (existingReceipt) return receiptFromRow(existingReceipt, true);

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
			if (!intentionalSoftDeleteRestore) {
				return rejectMutation(
					this.database,
					input.actorUserId,
					input.mutation,
					input.receivedAt,
					'tombstoned_entity'
				);
			}
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
		if (acceptedGroups.length === 0) {
			return rejectMutation(
				this.database,
				input.actorUserId,
				input.mutation,
				input.receivedAt,
				'historical_loser'
			);
		}

		const current =
			(await readLatestChangedAggregate(
				this.database,
				input.actorUserId,
				input.mutation.entityKind,
				input.mutation.entityId
			)) ??
			(await readNormalizedAggregate(
				this.database,
				input.actorUserId,
				input.mutation.entityKind,
				input.mutation.entityId
			));
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
				 VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
				  last_sequence, winning_occurred_at, winning_origin_device_id, winning_mutation_id)
				 VALUES ('user', ?, ?, ?, ?, ?,
				  (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, ?, ?)
				 ON CONFLICT(audience_kind, audience_id, entity_kind, entity_id, conflict_group)
				 DO UPDATE SET revision = excluded.revision, last_sequence = excluded.last_sequence,
				  winning_occurred_at = excluded.winning_occurred_at,
				  winning_origin_device_id = excluded.winning_origin_device_id,
				  winning_mutation_id = excluded.winning_mutation_id`
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
						input.mutation.mutationId
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
		await this.database.batch(statements);
		const receipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (!receipt) throw new TypeError('The committed mutation has no receipt.');
		return receiptFromRow(receipt);
	}

	async prune(input: { now: string; changeCutoff: string }): Promise<void> {
		await pruneSyncRetentionBatch(this.database, {
			audienceKind: 'user',
			...input
		});
	}
}
