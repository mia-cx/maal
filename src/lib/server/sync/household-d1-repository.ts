import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { isMealAggregate, type MealAggregate } from '$lib/domain/meals/schema.js';
import type { MutationReceipt } from '$lib/sync/contracts.js';
import type {
	HouseholdSyncChange,
	HouseholdSyncEntityKind,
	HouseholdSyncMutation
} from '$lib/sync/household-contracts.js';
import { decodeHouseholdSyncAggregate } from '$lib/sync/household-entities.js';
import { pruneSyncRetentionBatch } from '$lib/server/maintenance/sync-retention.js';

import { incomingWinsHistoricalConflict, type WinningClock } from './reconciliation.js';
import {
	householdSyncEntityKey,
	type HouseholdServerBootstrapSnapshot,
	type HouseholdServerSyncPage,
	type HouseholdServerSyncScopeState,
	type HouseholdSyncRepository
} from './household-repository.js';

type SqlValue = string | number | null | ArrayBuffer;

interface ScopeRow {
	bootstrap_generation: number;
	earliest_retained_sequence: number;
	latest_sequence: number;
}

interface ChangeRow {
	seq: number;
	mutation_id: string;
	actor_user_id: string;
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

const HOUSEHOLD_TABLES = {
	household: 'households',
	householdAppliance: 'household_appliances',
	foodHouseholdAlias: 'food_household_aliases',
	foodHouseholdEntry: 'food_household_entries',
	unitHouseholdAlias: 'unit_household_aliases',
	unitHouseholdEntry: 'unit_household_entries',
	householdFoodDisplayPreference: 'household_food_display_overrides',
	householdUnitDisplayPreference: 'household_unit_display_overrides'
} as const;

const HOUSEHOLD_TABLE_COLUMNS = {
	household: [
		'householdId',
		'name',
		'locale',
		'timezone',
		'weekStartsOn',
		'defaultPlannedYield',
		'preferredDinnerTime',
		'createdByUserId',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	householdAppliance: [
		'id',
		'householdId',
		'appliance',
		'available',
		'notes',
		'schemaVersion',
		'revision',
		'createdAt',
		'updatedAt',
		'deletedAt'
	],
	foodHouseholdAlias: [
		'id',
		'householdId',
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
	foodHouseholdEntry: [
		'id',
		'householdId',
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
	unitHouseholdAlias: [
		'id',
		'householdId',
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
	unitHouseholdEntry: [
		'id',
		'householdId',
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
	householdFoodDisplayPreference: [
		'id',
		'householdId',
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
	householdUnitDisplayPreference: [
		'id',
		'householdId',
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
} as const satisfies Record<keyof typeof HOUSEHOLD_TABLES, readonly string[]>;

const MEAL_PARENT_COLUMNS = [
	'id',
	'householdId',
	'sourceRecipeId',
	'title',
	'description',
	'imageUrl',
	'date',
	'time',
	'sortOrder',
	'plannedCookUserId',
	'yield',
	'plannedYield',
	'status',
	'prepTimeMinutes',
	'cookTimeMinutes',
	'totalTimeMinutes',
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
	'notes',
	'schemaVersion',
	'revision',
	'createdAt',
	'updatedAt',
	'deletedAt'
] as const;

const CHECK_IN_COLUMNS = [
	'id',
	'reporterUserId',
	'mealId',
	'cookTimeMinutes',
	'verdict',
	'reason',
	'schemaVersion',
	'revision',
	'createdAt',
	'updatedAt',
	'deletedAt'
] as const;

const MEAL_SIDE_CARS = [
	['ingredients', 'meal_ingredients', 'mealId'],
	['instructions', 'meal_instructions', 'mealId'],
	['instructionEvents', 'meal_instruction_events', null],
	['applianceRequirements', 'meal_appliance_requirements', 'mealId'],
	['classifications', 'meal_classifications', 'mealId'],
	['media', 'meal_media', 'mealId'],
	['nutritionFacts', 'meal_nutrition_facts', 'mealId']
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
	) {
		return value;
	}
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
	) {
		throw new TypeError('Unsupported persisted sync payload.');
	}
	const payload = (value as { payload?: unknown }).payload;
	if (typeof payload !== 'object' || payload === null) {
		throw new TypeError('Malformed persisted sync payload.');
	}
	const candidate = payload as { conflictGroups?: unknown; aggregate?: unknown };
	if (
		!Array.isArray(candidate.conflictGroups) ||
		!candidate.conflictGroups.every((group) => typeof group === 'string')
	) {
		throw new TypeError('Malformed persisted conflict groups.');
	}
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		payload: { conflictGroups: candidate.conflictGroups, aggregate: candidate.aggregate }
	};
};

const changeFromRow = (row: ChangeRow): HouseholdSyncChange => {
	const stored = decodeStoredPayload(row.payload);
	return {
		sequence: row.seq,
		mutationId: row.mutation_id,
		originDeviceId: row.origin_device_id,
		actorUserId: row.actor_user_id,
		entityKind: row.entity_kind as HouseholdSyncEntityKind,
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

const mergeMeal = (
	currentInput: unknown | null,
	incomingInput: unknown,
	acceptedGroups: readonly string[],
	revision: number,
	clock: WinningClock
): unknown => {
	const incoming = incomingInput as MealAggregate;
	const current = currentInput as MealAggregate | null;
	if (current === null || !isMealAggregate(current) || !isMealAggregate(incoming)) {
		return { ...incoming, revision, updatedAt: clock.occurredAt };
	}
	const next: Record<string, unknown> = { ...current };
	const incomingRecord: Record<string, unknown> = { ...incoming };
	const header = [
		'sourceRecipeId',
		'title',
		'description',
		'imageUrl',
		'yield',
		'prepTimeMinutes',
		'cookTimeMinutes',
		'totalTimeMinutes',
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
		'notes'
	];
	const groupFields: Record<string, readonly string[]> = {
		header,
		schedule: ['date', 'time', 'sortOrder', 'plannedCookUserId', 'plannedYield'],
		status: ['status'],
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
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	aggregate: Record<string, unknown>
): D1PreparedStatement[] => {
	if (entityKind === 'meal') {
		const mealId = String(aggregate.id);
		if ('purgedAt' in aggregate) {
			return [
				database
					.prepare('DELETE FROM meals WHERE id = ? AND household_id = ?')
					.bind(mealId, householdId)
			];
		}
		const statements = [upsert(database, 'meals', pickSnake(aggregate, MEAL_PARENT_COLUMNS))];
		statements.push(
			database
				.prepare(
					'DELETE FROM meal_instruction_events WHERE meal_instruction_id IN (SELECT id FROM meal_instructions WHERE meal_id = ?)'
				)
				.bind(mealId),
			database.prepare('DELETE FROM meal_ingredients WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_instructions WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_appliance_requirements WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_classifications WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_media WHERE meal_id = ?').bind(mealId),
			database.prepare('DELETE FROM meal_nutrition_facts WHERE meal_id = ?').bind(mealId)
		);
		for (const [property, table, ownerKey] of MEAL_SIDE_CARS) {
			const records = aggregate[property];
			if (!Array.isArray(records)) continue;
			for (const input of records) {
				const source = input as Record<string, unknown>;
				const row = Object.fromEntries(
					Object.entries(source).map(([key, value]) => [camelToSnake(key), sqlValue(value)])
				) as Record<string, SqlValue>;
				if (ownerKey) row[camelToSnake(ownerKey)] = mealId;
				statements.push(upsert(database, table, row));
			}
		}
		return statements;
	}
	if (entityKind === 'meal_check_in') {
		return [
			upsert(database, 'meal_check_ins', {
				...pickSnake(aggregate, CHECK_IN_COLUMNS),
				household_id: householdId
			})
		];
	}
	if (entityKind === 'household') {
		return [
			upsert(database, 'households', pickSnake(aggregate, HOUSEHOLD_TABLE_COLUMNS.household), [
				'household_id'
			])
		];
	}
	const table = HOUSEHOLD_TABLES[entityKind];
	return [upsert(database, table, pickSnake(aggregate, HOUSEHOLD_TABLE_COLUMNS[entityKind]))];
};

const scopeState = async (
	database: D1Database,
	householdId: string
): Promise<HouseholdServerSyncScopeState> => {
	const row = await database
		.prepare(
			`SELECT bootstrap_generation, earliest_retained_sequence, latest_sequence
			 FROM sync_scope_state WHERE audience_kind = 'household' AND audience_id = ?`
		)
		.bind(householdId)
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
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	entityId: string
): Promise<VersionRow[]> =>
	(
		await database
			.prepare(
				`SELECT conflict_group, revision, last_sequence, winning_occurred_at,
				 winning_origin_device_id, winning_mutation_id, winning_actor_user_id, winning_received_at
				 FROM sync_entity_versions
				 WHERE audience_kind = 'household' AND audience_id = ? AND entity_kind = ? AND entity_id = ?`
			)
			.bind(householdId, entityKind, entityId)
			.all<VersionRow>()
	).results;

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

const readLatestChangedAggregate = async (
	database: D1Database,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	entityId: string
): Promise<unknown | null> => {
	const row = await database
		.prepare(
			`SELECT payload FROM sync_changes
			 WHERE audience_kind = 'household' AND audience_id = ? AND entity_kind = ? AND entity_id = ?
			 ORDER BY seq DESC LIMIT 1`
		)
		.bind(householdId, entityKind, entityId)
		.first<{ payload: string }>();
	return row ? decodeStoredPayload(row.payload).payload.aggregate : null;
};

const readNormalizedAggregate = async (
	database: D1Database,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	entityId: string
): Promise<unknown | null> => {
	const versions = await readVersions(database, householdId, entityKind, entityId);
	if (entityKind === 'household') {
		const row = await database
			.prepare('SELECT * FROM households WHERE household_id = ?')
			.bind(householdId)
			.first<Record<string, unknown>>();
		return row
			? {
					...camelize(row),
					deletionState: 'active',
					localOnly: false,
					conflictClocks: conflictClocks(versions)
				}
			: null;
	}
	if (entityKind === 'meal_check_in') {
		const row = await database
			.prepare('SELECT * FROM meal_check_ins WHERE id = ? AND household_id = ?')
			.bind(entityId, householdId)
			.first<Record<string, unknown>>();
		return row
			? { ...camelize(row, ['household_id']), conflictClocks: conflictClocks(versions) }
			: readLatestChangedAggregate(database, householdId, entityKind, entityId);
	}
	if (entityKind !== 'meal') {
		const table = HOUSEHOLD_TABLES[entityKind];
		const row = await database
			.prepare(`SELECT * FROM ${assertIdentifier(table)} WHERE id = ? AND household_id = ?`)
			.bind(entityId, householdId)
			.first<Record<string, unknown>>();
		if (!row) return readLatestChangedAggregate(database, householdId, entityKind, entityId);
		const result = camelize(row);
		if (entityKind === 'householdAppliance') result.available = result.available === 1;
		return { ...result, conflictClocks: conflictClocks(versions) };
	}
	const row = await database
		.prepare('SELECT * FROM meals WHERE id = ? AND household_id = ?')
		.bind(entityId, householdId)
		.first<Record<string, unknown>>();
	if (!row) return readLatestChangedAggregate(database, householdId, entityKind, entityId);
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
		query('SELECT * FROM meal_ingredients WHERE meal_id = ? ORDER BY line_index', entityId),
		query('SELECT * FROM meal_instructions WHERE meal_id = ? ORDER BY step_index', entityId),
		query(
			'SELECT e.* FROM meal_instruction_events e JOIN meal_instructions i ON i.id = e.meal_instruction_id WHERE i.meal_id = ?',
			entityId
		),
		query('SELECT * FROM meal_appliance_requirements WHERE meal_id = ?', entityId),
		query('SELECT * FROM meal_classifications WHERE meal_id = ?', entityId),
		query('SELECT * FROM meal_media WHERE meal_id = ? ORDER BY position', entityId),
		query('SELECT * FROM meal_nutrition_facts WHERE meal_id = ?', entityId)
	]);
	const booleanize = (record: Record<string, unknown>, keys: readonly string[]) => {
		const result = camelize(record, ['meal_id']);
		for (const key of keys) if (key in result) result[key] = result[key] === 1;
		return result;
	};
	return {
		...camelize(row),
		conflictClocks: conflictClocks(versions),
		ingredients: ingredients.map((item) => booleanize(item, ['optional'])),
		instructions: instructions.map((item) => camelize(item, ['meal_id'])),
		instructionEvents: instructionEvents.map((item) => camelize(item)),
		applianceRequirements: applianceRequirements.map((item) => booleanize(item, ['required'])),
		classifications: classifications.map((item) => camelize(item, ['meal_id'])),
		media: media.map((item) => camelize(item, ['meal_id'])),
		nutritionFacts: nutritionFacts.map((item) => camelize(item, ['meal_id']))
	};
};

const syntheticChange = async (
	database: D1Database,
	householdId: string,
	entityKind: HouseholdSyncEntityKind,
	entityId: string,
	aggregate: unknown
): Promise<HouseholdSyncChange | null> => {
	const versions = await readVersions(database, householdId, entityKind, entityId);
	const winner = versions.toSorted((left, right) => right.last_sequence - left.last_sequence)[0];
	if (!winner) return null;
	const record = aggregate as { deletedAt?: string | null; purgedAt?: string };
	let actorUserId = winner.winning_actor_user_id;
	if (!actorUserId && entityKind === 'meal_check_in') {
		const reporterUserId = (aggregate as { reporterUserId?: unknown }).reporterUserId;
		if (typeof reporterUserId === 'string' && reporterUserId.length > 0)
			actorUserId = reporterUserId;
	}
	if (!actorUserId) {
		const household = await database
			.prepare('SELECT created_by_user_id FROM households WHERE household_id = ?')
			.bind(householdId)
			.first<{ created_by_user_id: string | null }>();
		actorUserId = household?.created_by_user_id ?? `household:${householdId}`;
	}
	return {
		sequence: winner.last_sequence,
		mutationId: winner.winning_mutation_id,
		originDeviceId: winner.winning_origin_device_id,
		actorUserId,
		entityKind,
		entityId,
		conflictGroups: versions.map(({ conflict_group }) => conflict_group) as [string, ...string[]],
		operation: record.deletedAt || record.purgedAt ? 'delete' : 'upsert',
		resultingRevision: Math.max(...versions.map(({ revision }) => revision)),
		occurredAt: winner.winning_occurred_at as `${string}Z`,
		receivedAt: (winner.winning_received_at ?? winner.winning_occurred_at) as `${string}Z`,
		aggregate,
		tombstoneExpiresAt: null
	};
};

export class D1HouseholdSyncRepository implements HouseholdSyncRepository {
	constructor(private readonly database: D1Database) {}

	readScopeState(householdId: string) {
		return scopeState(this.database, householdId);
	}

	async pull(householdId: string, after: number, limit: number): Promise<HouseholdServerSyncPage> {
		const state = await scopeState(this.database, householdId);
		const rows = (
			await this.database
				.prepare(
					`SELECT * FROM sync_changes
					 WHERE audience_kind = 'household' AND audience_id = ? AND seq > ?
					 ORDER BY seq LIMIT ?`
				)
				.bind(householdId, after, limit + 1)
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

	async bootstrap(householdId: string): Promise<HouseholdServerBootstrapSnapshot> {
		const state = await scopeState(this.database, householdId);
		const identities = (
			await this.database
				.prepare(
					`SELECT DISTINCT entity_kind, entity_id FROM sync_entity_versions
					 WHERE audience_kind = 'household' AND audience_id = ?`
				)
				.bind(householdId)
				.all<{ entity_kind: HouseholdSyncEntityKind; entity_id: string }>()
		).results;
		const aggregates: HouseholdSyncChange[] = [];
		const authoritativeIds = new Set<string>();
		for (const identity of identities) {
			const aggregate = await readNormalizedAggregate(
				this.database,
				householdId,
				identity.entity_kind,
				identity.entity_id
			);
			if (aggregate === null) continue;
			const change = await syntheticChange(
				this.database,
				householdId,
				identity.entity_kind,
				identity.entity_id,
				aggregate
			);
			if (!change) continue;
			aggregates.push(change);
			authoritativeIds.add(householdSyncEntityKey(identity.entity_kind, identity.entity_id));
		}
		aggregates.sort((left, right) => left.sequence - right.sequence);
		return { ...state, aggregates, authoritativeIds };
	}

	private async reject(input: {
		householdId: string;
		mutation: HouseholdSyncMutation;
		receivedAt: string;
		code: string;
	}): Promise<MutationReceipt> {
		const retainUntil = new Date(Date.parse(input.receivedAt) + 365 * 86_400_000).toISOString();
		await this.database
			.prepare(
				`INSERT INTO sync_mutation_receipts
				 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
				  resulting_revision, error_code, created_at, retain_until)
				 VALUES (?, 'household', ?, ?, ?, 'rejected', NULL, NULL, ?, ?, ?)`
			)
			.bind(
				input.mutation.mutationId,
				input.householdId,
				input.mutation.entityKind,
				input.mutation.entityId,
				input.code,
				input.receivedAt,
				retainUntil
			)
			.run();
		return {
			mutationId: input.mutation.mutationId,
			status: 'rejected',
			sequence: null,
			resultingRevision: null,
			errorCode: input.code
		};
	}

	async commit(input: {
		householdId: string;
		actorUserId: string;
		deviceId: string;
		mutation: HouseholdSyncMutation;
		mode: 'live' | 'backfill';
		receivedAt: string;
	}): Promise<MutationReceipt> {
		const existingReceipt = await this.database
			.prepare('SELECT * FROM sync_mutation_receipts WHERE mutation_id = ?')
			.bind(input.mutation.mutationId)
			.first<ReceiptRow>();
		if (existingReceipt) return receiptFromRow(existingReceipt, true);

		const decodedIncoming = decodeHouseholdSyncAggregate(
			input.mutation.entityKind,
			input.mutation.entityId,
			input.householdId,
			input.mutation.aggregate
		);
		if (input.mutation.entityKind === 'meal_check_in') {
			const mealId = decodedIncoming.aggregate.mealId;
			if (typeof mealId === 'string') {
				const ownedMeal = await this.database
					.prepare('SELECT 1 AS present FROM meals WHERE id = ? AND household_id = ?')
					.bind(mealId, input.householdId)
					.first<{ present: number }>();
				if (!ownedMeal) return this.reject({ ...input, code: 'meal_household_mismatch' });
			}
		}
		if (input.mutation.entityKind === 'meal') {
			const plannedCookUserId = decodedIncoming.aggregate.plannedCookUserId;
			if (typeof plannedCookUserId === 'string') {
				const currentMember = await this.database
					.prepare(
						`SELECT 1 AS present FROM household_memberships
						 WHERE household_id = ? AND workos_user_id = ? AND status = 'active'`
					)
					.bind(input.householdId, plannedCookUserId)
					.first<{ present: number }>();
				if (!currentMember) return this.reject({ ...input, code: 'planned_cook_not_member' });
			}
		}
		const activeTombstone = await this.database
			.prepare(
				`SELECT 1 AS present FROM sync_tombstones
				 WHERE audience_kind = 'household' AND audience_id = ? AND entity_kind = ? AND entity_id = ?
				 AND expires_at > ?`
			)
			.bind(input.householdId, input.mutation.entityKind, input.mutation.entityId, input.receivedAt)
			.first<{ present: number }>();
		if (activeTombstone && input.mutation.operation === 'upsert') {
			return this.reject({ ...input, code: 'tombstoned_entity' });
		}

		const versions = await readVersions(
			this.database,
			input.householdId,
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
		if (acceptedGroups.length === 0) {
			return this.reject({ ...input, code: 'historical_loser' });
		}

		const current = await readNormalizedAggregate(
			this.database,
			input.householdId,
			input.mutation.entityKind,
			input.mutation.entityId
		);
		const revision = Math.max(0, ...versions.map(({ revision }) => revision)) + 1;
		const clock = {
			occurredAt: input.mutation.occurredAt,
			originDeviceId: input.mutation.originDeviceId,
			mutationId: input.mutation.mutationId
		};
		const tombstoneExpiresAt =
			input.mutation.operation === 'delete'
				? new Date(Date.parse(input.receivedAt) + 365 * 86_400_000).toISOString()
				: null;
		const result =
			input.mutation.operation === 'delete' && input.mutation.entityKind === 'meal'
				? {
						schemaVersion: CURRENT_SCHEMA_VERSION,
						revision,
						createdAt: decodedIncoming.aggregate.createdAt,
						updatedAt: input.mutation.occurredAt,
						deletedAt: input.mutation.occurredAt,
						conflictClocks: { deletion: clock },
						id: input.mutation.entityId,
						householdId: input.householdId,
						purgedAt: input.receivedAt,
						retainUntil: tombstoneExpiresAt!
					}
				: input.mutation.entityKind === 'meal'
					? mergeMeal(current, decodedIncoming.aggregate, acceptedGroups, revision, clock)
					: {
							...decodedIncoming.aggregate,
							revision,
							updatedAt: input.mutation.occurredAt,
							conflictClocks: {
								...((current as { conflictClocks?: Record<string, unknown> } | null)
									?.conflictClocks ?? {}),
								...Object.fromEntries(acceptedGroups.map((group) => [group, clock]))
							}
						};
		const decodedResult = decodeHouseholdSyncAggregate(
			input.mutation.entityKind,
			input.mutation.entityId,
			input.householdId,
			result
		);
		const payload = JSON.stringify({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			payload: { conflictGroups: acceptedGroups, aggregate: decodedResult.aggregate }
		});
		const receiptRetainUntil = new Date(
			Date.parse(input.receivedAt) + 365 * 86_400_000
		).toISOString();
		const statements = [
			this.database
				.prepare(
					`INSERT INTO users (workos_user_id, schema_version, revision, created_at, updated_at)
					 VALUES (?, 1, 1, ?, ?) ON CONFLICT(workos_user_id) DO NOTHING`
				)
				.bind(input.actorUserId, input.receivedAt, input.receivedAt),
			...normalizedStatements(
				this.database,
				input.householdId,
				input.mutation.entityKind,
				decodedResult.aggregate
			),
			this.database
				.prepare(
					`INSERT INTO sync_changes
					 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
					  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
					  payload, tombstone_expires_at)
					 VALUES (?, ?, ?, 'household', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					input.mutation.mutationId,
					input.actorUserId,
					input.mutation.originDeviceId,
					input.householdId,
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
						  last_sequence, winning_occurred_at, winning_origin_device_id, winning_mutation_id,
						  winning_actor_user_id, winning_received_at)
						 VALUES ('household', ?, ?, ?, ?, ?,
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
						input.householdId,
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
					 VALUES ('household', ?, 1, 0, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?)
					 ON CONFLICT(audience_kind, audience_id) DO UPDATE SET
					  latest_sequence = excluded.latest_sequence, updated_at = excluded.updated_at`
				)
				.bind(input.householdId, input.mutation.mutationId, input.receivedAt),
			this.database
				.prepare(
					`INSERT INTO sync_devices
					 (device_id, workos_user_id, created_at, last_seen_at, last_app_version, last_protocol_version)
					 VALUES (?, ?, ?, ?, 'v1', 1)
					 ON CONFLICT(device_id, workos_user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
					  last_app_version = excluded.last_app_version,
					  last_protocol_version = excluded.last_protocol_version`
				)
				.bind(input.deviceId, input.actorUserId, input.receivedAt, input.receivedAt),
			this.database
				.prepare(
					`INSERT INTO sync_mutation_receipts
					 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
					  resulting_revision, error_code, created_at, retain_until)
					 VALUES (?, 'household', ?, ?, ?, 'accepted',
					  (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, NULL, ?, ?)`
				)
				.bind(
					input.mutation.mutationId,
					input.householdId,
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
						 VALUES ('household', ?, ?, ?, (SELECT seq FROM sync_changes WHERE mutation_id = ?), ?, ?, 1)
						 ON CONFLICT(audience_kind, audience_id, entity_kind, entity_id) DO UPDATE SET
						  deletion_sequence = excluded.deletion_sequence, deleted_at = excluded.deleted_at,
						  expires_at = excluded.expires_at, previous_server_ack = 1`
					)
					.bind(
						input.householdId,
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
						`DELETE FROM sync_tombstones WHERE audience_kind = 'household' AND audience_id = ?
						 AND entity_kind = ? AND entity_id = ?`
					)
					.bind(input.householdId, input.mutation.entityKind, input.mutation.entityId)
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
			audienceKind: 'household',
			...input
		});
	}
}
