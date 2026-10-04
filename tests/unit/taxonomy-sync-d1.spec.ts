import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/database.js';
import {
	applyHouseholdBootstrap,
	applyUserBootstrap,
	buildHouseholdSnapshotManifest,
	buildUserSnapshotManifest,
	createHouseholdSyncCoordinator,
	createUserSyncCoordinator,
	type HouseholdSyncTransport,
	type UserSyncEnvironment,
	type UserSyncTransport
} from '$lib/client/sync/index.js';
import {
	upsertTaxonomyRecord,
	type TaxonomyDraft,
	type TaxonomyEditableRecordMap
} from '$lib/client/taxonomy/index.js';
import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import type { TaxonomyEditableEntityKind } from '$lib/domain/taxonomy/schema.js';
import {
	D1HouseholdSyncRepository,
	D1UserSyncRepository,
	backfillHouseholdSync,
	backfillUserSync,
	bootstrapHouseholdSync,
	bootstrapUserSync,
	pullHouseholdSync,
	pullUserSync,
	pushHouseholdSync,
	pushUserSync
} from '$lib/server/sync/index.js';
import { HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS } from '$lib/sync/household-entities.js';
import { USER_SYNC_ENTITY_DESCRIPTORS } from '$lib/sync/user-entities.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const userId = 'user_alice';
const householdId = 'org_family';
const authSlotId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const timestamp = '2026-08-21T12:00:00.000Z' as const;
const now = () => new Date(timestamp);
let miniflare: Miniflare;
let d1: D1Database;
const dexies: MaalDatabase[] = [];

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(timestamp));
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	d1 = await miniflare.getD1Database('DB');
	await applyD1Migrations(d1, await readD1MigrationFiles());
	await d1.prepare('INSERT INTO users (workos_user_id) VALUES (?)').bind(userId).run();
	await d1
		.prepare('INSERT INTO households (household_id, created_by_user_id) VALUES (?, ?)')
		.bind(householdId, userId)
		.run();
	await d1
		.prepare(
			"INSERT INTO foods (id, default_measure_unit_id, default_measure_base_unit_id) VALUES ('tomatoes', 'grams', 'grams')"
		)
		.run();
});

afterEach(async () => {
	for (const dexie of dexies) {
		dexie.close();
		await Dexie.delete(dexie.name);
	}
	dexies.length = 0;
	await miniflare.dispose();
	vi.useRealTimers();
});

const openDevice = async (): Promise<MaalDatabase> => {
	const dexie = await openMaalDatabase(`taxonomy-sync-${crypto.randomUUID()}`);
	dexies.push(dexie);
	await dexie.foods.put({
		id: 'tomatoes',
		defaultMeasureUnitId: 'grams',
		defaultMeasureBaseUnitId: 'grams'
	});
	return dexie;
};

// Save-data skips backfill, so only the outbox rows the commands wrote reach D1.
const environment: UserSyncEnvironment = {
	isOnline: () => true,
	isVisible: () => true,
	isSaveDataEnabled: () => true,
	on: () => () => undefined
};

const userTransport = (repository: D1UserSyncRepository): UserSyncTransport => ({
	pull: (_slot, request) => pullUserSync(repository, userId, request),
	push: (_slot, request) => pushUserSync(repository, userId, request, now),
	bootstrap: (_slot, request) => bootstrapUserSync(repository, userId, request),
	backfill: (_slot, request) => backfillUserSync(repository, userId, request, now)
});

const householdTransport = (repository: D1HouseholdSyncRepository): HouseholdSyncTransport => ({
	pull: (_slot, request) => pullHouseholdSync(repository, householdId, request),
	push: (_slot, request) => pushHouseholdSync(repository, householdId, userId, request, now),
	bootstrap: (_slot, request) => bootstrapHouseholdSync(repository, householdId, request),
	backfill: (_slot, request) => backfillHouseholdSync(repository, householdId, userId, request, now)
});

const userFoodAliasId = uuidv7();
const householdFoodAliasId = uuidv7();
const userUnitAliasId = uuidv7();
const householdUnitAliasId = uuidv7();

// Every nullable field is filled per kind, and every adoption status and alias scope appears.
const drafts: {
	[K in TaxonomyEditableEntityKind]: TaxonomyDraft<TaxonomyEditableRecordMap[K]>;
} = {
	foodUserAlias: {
		id: userFoodAliasId,
		workosUserId: userId,
		foodId: 'tomatoes',
		alias: 'pomodori',
		locale: 'it-IT',
		sourceDomain: 'recipes.example',
		adoptionStatus: 'accepted',
		defaultMeasureUnitId: 'kilograms',
		defaultMeasureBaseUnitId: 'grams'
	},
	foodHouseholdAlias: {
		id: householdFoodAliasId,
		householdId,
		foodId: 'tomatoes',
		alias: 'tomaatjes',
		locale: 'nl-NL',
		sourceDomain: 'recipes.example',
		adoptionStatus: 'pending_review',
		defaultMeasureUnitId: 'kilograms',
		defaultMeasureBaseUnitId: 'grams'
	},
	foodUserEntry: {
		id: uuidv7(),
		workosUserId: userId,
		canonicalLabel: 'smoked salt',
		defaultMeasureUnitId: 'grams',
		defaultMeasureBaseUnitId: 'grams',
		adoptionStatus: 'rejected'
	},
	foodHouseholdEntry: {
		id: uuidv7(),
		householdId,
		canonicalLabel: 'weeknight sauce',
		defaultMeasureUnitId: 'kilograms',
		defaultMeasureBaseUnitId: 'grams',
		adoptionStatus: 'rejected'
	},
	unitUserAlias: {
		id: userUnitAliasId,
		workosUserId: userId,
		unitId: 'kilograms',
		baseUnitId: 'grams',
		alias: 'kilo bag',
		pluralAlias: 'kilo bags',
		locale: 'en-NL',
		sourceDomain: 'recipes.example',
		adoptionStatus: 'pending_review'
	},
	unitHouseholdAlias: {
		id: householdUnitAliasId,
		householdId,
		unitId: 'fahrenheit',
		baseUnitId: 'celsius',
		alias: 'graden F',
		pluralAlias: 'graden Fahrenheit',
		locale: 'nl-NL',
		sourceDomain: 'recipes.example',
		adoptionStatus: 'accepted'
	},
	unitUserEntry: {
		id: uuidv7(),
		workosUserId: userId,
		canonicalLabel: 'oven mark',
		baseUnitId: 'celsius',
		toBaseFactor: 0.555555555555556,
		toBaseOffset: -17.7777777777778,
		adoptionStatus: 'accepted'
	},
	unitHouseholdEntry: {
		id: uuidv7(),
		householdId,
		canonicalLabel: 'house scoop',
		baseUnitId: 'grams',
		toBaseFactor: 12.5,
		toBaseOffset: -0.5,
		adoptionStatus: 'pending_review'
	},
	userFoodPreference: {
		id: uuidv7(),
		workosUserId: userId,
		foodId: 'tomatoes',
		preference: 'disallowed',
		reason: 'allergy'
	},
	userFoodDisplayPreference: {
		id: uuidv7(),
		workosUserId: userId,
		foodId: 'tomatoes',
		locale: 'it-IT',
		preferredFoodAliasScope: 'user',
		preferredFoodAliasId: userFoodAliasId,
		preferredMeasureUnitId: 'kilograms',
		preferredMeasureBaseUnitId: 'grams'
	},
	householdFoodDisplayPreference: {
		id: uuidv7(),
		householdId,
		foodId: 'tomatoes',
		locale: 'nl-NL',
		preferredFoodAliasScope: 'household',
		preferredFoodAliasId: householdFoodAliasId,
		preferredMeasureUnitId: 'kilograms',
		preferredMeasureBaseUnitId: 'grams'
	},
	userUnitDisplayPreference: {
		id: uuidv7(),
		workosUserId: userId,
		baseUnitId: 'grams',
		locale: 'en-NL',
		preferredUnitId: 'kilograms',
		preferredUnitAliasScope: 'user',
		preferredUnitAliasId: userUnitAliasId
	},
	householdUnitDisplayPreference: {
		id: uuidv7(),
		householdId,
		baseUnitId: 'celsius',
		locale: 'nl-NL',
		preferredUnitId: 'fahrenheit',
		preferredUnitAliasScope: 'household',
		preferredUnitAliasId: householdUnitAliasId
	}
};

const storeFor = (kind: TaxonomyEditableEntityKind): string =>
	kind in USER_SYNC_ENTITY_DESCRIPTORS
		? USER_SYNC_ENTITY_DESCRIPTORS[kind as keyof typeof USER_SYNC_ENTITY_DESCRIPTORS].store
		: HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS[kind as keyof typeof HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS]
				.store;

test('every editable taxonomy kind survives Dexie -> mutation -> D1 -> Dexie unchanged', async () => {
	const userRepository = new D1UserSyncRepository(d1);
	const householdRepository = new D1HouseholdSyncRepository(d1);

	const source = await openDevice();
	const context = { database: source, authSlotId, originDeviceId: uuidv7(), occurredAt: timestamp };
	const written = new Map<TaxonomyEditableEntityKind, { id: string }>();
	for (const kind of Object.keys(drafts) as TaxonomyEditableEntityKind[]) {
		written.set(kind, await upsertTaxonomyRecord(context, kind, drafts[kind] as never));
	}

	const userSync = createUserSyncCoordinator({
		database: source,
		authSlotId,
		workosUserId: userId,
		transport: userTransport(userRepository),
		environment,
		capabilityResolver: async () => ({ enabled: true, stale: false, householdId }),
		now
	});
	const householdSync = createHouseholdSyncCoordinator({
		database: source,
		authSlotId,
		workosUserId: userId,
		householdId,
		transport: householdTransport(householdRepository),
		environment,
		capabilityResolver: async () => ({
			enabled: true,
			stale: false,
			membershipActive: true,
			permissions: ['meals:read', 'meals:write', 'households:write']
		}),
		now
	});
	await expect(userSync.syncNow()).resolves.toBe('complete');
	await expect(householdSync.syncNow()).resolves.toBe('complete');
	const outbox = await source.outbox.toArray();
	expect(outbox).toHaveLength(written.size);
	expect(outbox.every(({ status }) => status === 'acknowledged')).toBe(true);

	// Bootstrap rebuilds aggregates from normalized D1 rows, not the change log.
	await d1.prepare('DELETE FROM sync_changes').run();
	const replica = await openDevice();
	const deviceId = uuidv7();
	await applyUserBootstrap(
		replica,
		userId,
		await bootstrapUserSync(userRepository, userId, {
			protocolVersion: CURRENT_PROTOCOL_VERSION,
			deviceId,
			audience: { kind: 'user', id: userId },
			manifest: await buildUserSnapshotManifest(replica, userId),
			afterEntityKey: null,
			limit: 100
		}),
		now()
	);
	await applyHouseholdBootstrap(
		replica,
		householdId,
		await bootstrapHouseholdSync(householdRepository, householdId, {
			protocolVersion: CURRENT_PROTOCOL_VERSION,
			deviceId,
			audience: { kind: 'household', id: householdId },
			manifest: await buildHouseholdSnapshotManifest(replica, householdId),
			afterEntityKey: null,
			limit: 100
		}),
		now()
	);

	for (const [kind, record] of written) {
		await expect(replica.table(storeFor(kind)).get(record.id), kind).resolves.toEqual(record);
	}
});
