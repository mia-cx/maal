import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Schema } from 'effect';
import { get } from 'svelte/store';
import { uuidv7 } from 'uuidv7';
import { afterEach, describe, expect, test } from 'vitest';

import {
	DATABASE_STORES,
	DATABASE_V1_STORES,
	CURRENT_DATABASE_VERSION,
	MaalDatabase,
	acquireSyncLease,
	createDecodedLiveQuery,
	executeLocalCommand,
	exportDecodableRecoveryData,
	getMaalDatabaseName,
	getRecoveryResetConfirmation,
	markRecoveryRequired,
	openMaalDatabase,
	openRecoveryDatabase,
	pauseLocalCommits,
	readRecoveryState,
	releaseSyncLease,
	resetCommitActivityForTests,
	resumeLocalCommits,
	resetRecoveredDatabase
} from '$lib/client/local/index.js';
import {
	ConfidenceSchema,
	DomainIdSchema,
	LocalDateSchema,
	LocalTimeSchema,
	MutableAggregateFields,
	UtcInstantSchema,
	isOptionalPair
} from '$lib/domain/contracts/primitives.js';

const TestAggregateSchema = Schema.Struct({
	...MutableAggregateFields,
	id: Schema.String,
	title: Schema.String,
	ownerUserId: Schema.String
});

const databases: Dexie[] = [];
const databaseNames = new Set<string>();

const environmentName = (): string => `test-${crypto.randomUUID()}`;

const openDatabase = async (environment = environmentName()): Promise<MaalDatabase> => {
	const database = await openMaalDatabase(environment);
	databases.push(database);
	databaseNames.add(database.name);
	return database;
};

afterEach(async () => {
	for (const database of databases) database.close();
	await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
	databases.length = 0;
	databaseNames.clear();
	resetCommitActivityForTests();
});

describe('shared contracts', () => {
	test('rejects invalid IDs, UTC instants, dates, times, confidence, and nullable pairs', () => {
		expect(Schema.decodeUnknownSync(DomainIdSchema)(uuidv7())).toMatch(/-7/);
		expect(() => Schema.decodeUnknownSync(DomainIdSchema)(crypto.randomUUID())).toThrow();
		expect(Schema.decodeUnknownSync(UtcInstantSchema)('2026-08-21T12:00:00.000Z')).toBe(
			'2026-08-21T12:00:00.000Z'
		);
		expect(() => Schema.decodeUnknownSync(UtcInstantSchema)('2026-08-21T12:00:00+02:00')).toThrow();
		expect(Schema.decodeUnknownSync(LocalDateSchema)('2024-02-29')).toBe('2024-02-29');
		expect(() => Schema.decodeUnknownSync(LocalDateSchema)('2025-02-29')).toThrow();
		expect(Schema.decodeUnknownSync(LocalTimeSchema)('23:59:59')).toBe('23:59:59');
		expect(() => Schema.decodeUnknownSync(LocalTimeSchema)('24:00')).toThrow();
		expect(Schema.decodeUnknownSync(ConfidenceSchema)(1)).toBe(1);
		expect(() => Schema.decodeUnknownSync(ConfidenceSchema)(1.01)).toThrow();
		expect(isOptionalPair(null, null)).toBe(true);
		expect(isOptionalPair('unit', null)).toBe(false);
	});
});

describe('shared device database', () => {
	test('uses one environment database for every profile and household scope', async () => {
		const environment = environmentName();
		const database = await openDatabase(environment);

		expect(database.name).toBe(getMaalDatabaseName(environment));
		expect(database.tables.map(({ name }) => name).sort()).toEqual(
			Object.keys(DATABASE_STORES).sort()
		);

		await database.profiles.bulkAdd([
			{
				profileId: uuidv7(),
				workosUserId: 'user_alice',
				displayName: 'Alice',
				email: null,
				profilePictureUrl: null,
				locale: 'en-NL',
				timezone: 'Europe/Amsterdam',
				pinSalt: null,
				pinVerifier: null,
				lockPolicy: 'none',
				lastUsedAt: '2026-08-21T10:00:00.000Z',
				authState: 'authenticated'
			},
			{
				profileId: uuidv7(),
				workosUserId: 'user_bob',
				displayName: 'Bob',
				email: null,
				profilePictureUrl: null,
				locale: 'en-NL',
				timezone: 'Europe/Amsterdam',
				pinSalt: null,
				pinVerifier: null,
				lockPolicy: 'none',
				lastUsedAt: '2026-08-21T11:00:00.000Z',
				authState: 'authenticated'
			}
		]);
		const timestamp = '2026-08-21T10:00:00.000Z';
		await database.households.bulkAdd([
			{
				householdId: 'household_one',
				name: 'One',
				locale: 'en-NL',
				timezone: 'Europe/Amsterdam',
				weekStartsOn: 1,
				defaultPlannedYield: 4,
				preferredDinnerTime: '18:00',
				createdByUserId: 'user_alice',
				deletionState: 'active',
				localOnly: false,
				schemaVersion: 1,
				revision: 1,
				createdAt: timestamp,
				updatedAt: timestamp,
				deletedAt: null,
				conflictClocks: {}
			},
			{
				householdId: 'household_two',
				name: 'Two',
				locale: 'en-NL',
				timezone: 'Europe/Amsterdam',
				weekStartsOn: 1,
				defaultPlannedYield: 2,
				preferredDinnerTime: null,
				createdByUserId: 'user_bob',
				deletionState: 'active',
				localOnly: false,
				schemaVersion: 1,
				revision: 1,
				createdAt: timestamp,
				updatedAt: timestamp,
				deletedAt: null,
				conflictClocks: {}
			}
		]);

		await expect(database.profiles.count()).resolves.toBe(2);
		await expect(database.households.count()).resolves.toBe(2);
	});

	test('runs a non-destructive forward migration and initializes missing metadata', async () => {
		const environment = environmentName();
		const name = getMaalDatabaseName(environment);
		const aggregateId = uuidv7();
		const legacy = new Dexie(name);
		legacy.version(1).stores(DATABASE_V1_STORES);
		await legacy.open();
		await legacy.table('recipes').put({
			id: aggregateId,
			title: 'Preserved recipe',
			ownerUserId: 'user_alice'
		});
		await legacy.table('meta').put({
			key: 'databaseVersion',
			value: 1,
			updatedAt: '2026-08-20T12:00:00.000Z'
		});
		legacy.close();
		databaseNames.add(name);

		const migrated = await openDatabase(environment);

		await expect(migrated.recipes.get(aggregateId)).resolves.toMatchObject({
			id: aggregateId,
			title: 'Preserved recipe'
		});
		await expect(migrated.meta.get('migrationState')).resolves.toMatchObject({
			value: { from: 4, to: CURRENT_DATABASE_VERSION, state: 'complete' }
		});
		await expect(migrated.meta.get('databaseVersion')).resolves.toMatchObject({
			value: CURRENT_DATABASE_VERSION
		});
		await expect(migrated.meta.get('deviceId')).resolves.toMatchObject({
			key: 'deviceId'
		});
	});

	test('closes an older connection when another tab opens a newer schema', async () => {
		const environment = environmentName();
		const database = await openDatabase(environment);
		const upgradedTab = new Dexie(database.name);
		upgradedTab
			.version(CURRENT_DATABASE_VERSION + 1)
			.stores({ ...DATABASE_STORES, versionProbe: '&id' });
		databases.push(upgradedTab);

		await upgradedTab.open();

		expect(database.isOpen()).toBe(false);
		expect(upgradedTab.isOpen()).toBe(true);
	});

	test('opens the last committed schema for recovery without rerunning upgrades', async () => {
		const environment = environmentName();
		const name = getMaalDatabaseName(environment);
		const previous = new Dexie(name);
		previous.version(1).stores({ preserved: '&id' });
		await previous.open();
		await previous.table('preserved').put({ id: 'safe', title: 'Still here' });
		previous.close();
		databaseNames.add(name);

		const recovery = await openRecoveryDatabase(environment);
		databases.push(recovery);

		await expect(recovery.table('preserved').get('safe')).resolves.toEqual({
			id: 'safe',
			title: 'Still here'
		});
	});
});

describe('local command boundary', () => {
	test('refuses to begin a command while a coordinated update pauses writes', async () => {
		const database = await openDatabase();
		pauseLocalCommits(database.name, 'pwa-update');

		await expect(
			executeLocalCommand(database, {
				authSlotId: uuidv7(),
				scopeKind: 'user',
				scopeId: 'user_alice',
				entityKind: 'recipe',
				aggregateId: uuidv7(),
				conflictGroup: 'header',
				operation: 'upsert',
				originDeviceId: uuidv7(),
				payload: { title: 'Blocked' },
				payloadSchema: Schema.Struct({ title: Schema.String }),
				writes: []
			})
		).rejects.toMatchObject({ _tag: 'LocalPersistenceError' });

		resumeLocalCommits(database.name, 'pwa-update');
	});

	test('updates the aggregate, conflict clock, and outbox in one transaction', async () => {
		const database = await openDatabase();
		const aggregateId = uuidv7();
		const relatedAggregateId = uuidv7();
		const mutationId = uuidv7();
		const originDeviceId = uuidv7();
		const occurredAt = '2026-08-21T12:00:00.000Z';

		const result = await executeLocalCommand(database, {
			authSlotId: 'slot-alice',
			scopeKind: 'user',
			scopeId: 'user_alice',
			entityKind: 'recipe',
			aggregateId,
			conflictGroup: 'header',
			operation: 'upsert',
			originDeviceId,
			occurredAt,
			mutationId,
			payload: { title: 'Soup' },
			payloadSchema: Schema.Struct({ title: Schema.String }),
			writes: [
				{
					store: 'recipes',
					aggregateId,
					conflictGroups: ['header'],
					schema: TestAggregateSchema,
					update: () => ({ title: 'Soup', ownerUserId: 'user_alice', deletedAt: null })
				},
				{
					store: 'meals',
					aggregateId: relatedAggregateId,
					conflictGroups: ['header', 'schedule'],
					schema: TestAggregateSchema,
					update: () => ({
						title: 'Soup tonight',
						ownerUserId: 'user_alice',
						deletedAt: null
					})
				}
			]
		});

		expect(result.mutationId).toBe(mutationId);
		expect(result.aggregates).toHaveLength(2);
		await expect(database.recipes.get(aggregateId)).resolves.toMatchObject({
			id: aggregateId,
			title: 'Soup',
			revision: 1,
			conflictClocks: {
				header: { occurredAt, originDeviceId, mutationId }
			}
		});
		await expect(database.outbox.get(mutationId)).resolves.toMatchObject({
			mutationId,
			status: 'pending',
			payload: { title: 'Soup' }
		});
		await expect(database.meals.get(relatedAggregateId)).resolves.toMatchObject({
			id: relatedAggregateId,
			revision: 1,
			conflictClocks: {
				header: { mutationId },
				schedule: { mutationId }
			}
		});
		await expect(database.outbox.count()).resolves.toBe(1);
	});

	test('aborts the complete transaction when IndexedDB reports quota exhaustion', async () => {
		const database = await openDatabase();
		const aggregateId = uuidv7();
		database.outbox.hook('creating', () => {
			throw new DOMException('Storage full', 'QuotaExceededError');
		});

		await expect(
			executeLocalCommand(database, {
				authSlotId: 'slot-alice',
				scopeKind: 'user',
				scopeId: 'user_alice',
				entityKind: 'recipe',
				aggregateId,
				conflictGroup: 'header',
				operation: 'upsert',
				originDeviceId: uuidv7(),
				payload: { title: 'No room' },
				payloadSchema: Schema.Struct({ title: Schema.String }),
				writes: [
					{
						store: 'recipes',
						aggregateId,
						conflictGroups: ['header'],
						schema: TestAggregateSchema,
						update: () => ({
							title: 'No room',
							ownerUserId: 'user_alice',
							deletedAt: null
						})
					}
				]
			})
		).rejects.toMatchObject({ _tag: 'LocalQuotaExceededError' });
		await expect(database.recipes.get(aggregateId)).resolves.toBeUndefined();
		await expect(database.outbox.count()).resolves.toBe(0);
	});
});

describe('decoded local observation', () => {
	test('emits only contract-decoded values from a Dexie live query', async () => {
		const database = await openDatabase();
		const values: string[][] = [];
		const store = createDecodedLiveQuery({
			database,
			schema: Schema.Array(Schema.String),
			initialValue: [],
			query: async (local) =>
				(await local.uiState.orderBy('key').toArray()).map((record) => record.value)
		});
		const subscription = store.subscribe((value) => values.push([...value]));

		await database.uiState.put({ key: 'route', value: '/recipes' });
		await expect.poll(() => values.at(-1)).toEqual(['/recipes']);
		expect(get(store)).toEqual(['/recipes']);
		subscription();
	});

	test('reports malformed local values without exposing their contents', async () => {
		const database = await openDatabase();
		await database.uiState.put({ key: 'route', value: 42 });
		let failureTag: string | undefined;
		const store = createDecodedLiveQuery({
			database,
			schema: Schema.Array(Schema.String),
			initialValue: [],
			query: async (local) => (await local.uiState.toArray()).map(({ value }) => value),
			onError: (error) => {
				failureTag = error._tag;
			}
		});
		const unsubscribe = store.subscribe(() => undefined);

		await expect.poll(() => failureTag).toBe('LocalDecodeError');
		unsubscribe();
	});
});

describe('sync leases and recovery', () => {
	test('serializes a scope lease across two tabs and permits takeover after expiry', async () => {
		const environment = environmentName();
		const firstTab = await openDatabase(environment);
		const secondTab = await openDatabase(environment);
		const start = new Date('2026-08-21T12:00:00.000Z');

		const firstLease = await acquireSyncLease(firstTab, {
			scopeKind: 'household',
			scopeId: 'household_one',
			owner: 'tab-one',
			ttlMilliseconds: 10_000,
			now: start
		});
		expect(firstLease).not.toBeNull();
		await expect(
			acquireSyncLease(secondTab, {
				scopeKind: 'household',
				scopeId: 'household_one',
				owner: 'tab-two',
				ttlMilliseconds: 10_000,
				now: new Date(start.getTime() + 5_000)
			})
		).resolves.toBeNull();

		const secondLease = await acquireSyncLease(secondTab, {
			scopeKind: 'household',
			scopeId: 'household_one',
			owner: 'tab-two',
			ttlMilliseconds: 10_000,
			now: new Date(start.getTime() + 10_001)
		});
		expect(secondLease?.owner).toBe('tab-two');
		await expect(releaseSyncLease(firstTab, firstLease!)).resolves.toBe(false);
		await expect(releaseSyncLease(secondTab, secondLease!)).resolves.toBe(true);
	});

	test('exports decodable records and requires an exact confirmation before reset', async () => {
		const database = await openDatabase();
		const validId = uuidv7();
		await database.recipes.bulkPut([
			{
				id: validId,
				schemaVersion: 1,
				revision: 1,
				createdAt: '2026-08-21T12:00:00.000Z',
				updatedAt: '2026-08-21T12:00:00.000Z',
				deletedAt: null,
				conflictClocks: {},
				title: 'Good',
				ownerUserId: 'user_alice'
			},
			{ id: uuidv7(), title: 42 } as never
		]);
		await markRecoveryRequired(database, 'recipe_decode_failed');

		await expect(readRecoveryState(database)).resolves.toMatchObject({
			state: 'required',
			code: 'recipe_decode_failed'
		});
		const recoveryExport = await exportDecodableRecoveryData(database, {
			recipes: TestAggregateSchema
		});
		expect(recoveryExport.records.recipes).toHaveLength(1);
		expect(recoveryExport.skipped.recipes).toBe(1);
		await expect(resetRecoveredDatabase(database, 'RESET')).rejects.toMatchObject({
			_tag: 'LocalRecoveryConfirmationError'
		});
		await expect(database.recipes.count()).resolves.toBe(2);

		await resetRecoveredDatabase(database, getRecoveryResetConfirmation(database));
		expect(await Dexie.exists(database.name)).toBe(false);
	});
});
