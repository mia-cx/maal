import { readFile } from 'node:fs/promises';

import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	pruneSyncRetentionBatch,
	readD1ServerNow,
	runScheduledSyncRetention
} from '$lib/server/maintenance/index.js';
import { D1UserSyncRepository, pullUserSync } from '$lib/server/sync/index.js';

let miniflare: Miniflare;
let database: D1Database;

const applyMigration = async (path: string): Promise<void> => {
	const source = await readFile(path, 'utf8');
	for (const statement of source
		.split('--> statement-breakpoint')
		.map((part) => part.trim())
		.filter(Boolean)) {
		await database.prepare(statement).run();
	}
};

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	for (const migration of [
		'drizzle/0000_quick_hitman.sql',
		'drizzle/0001_long_mysterio.sql',
		'drizzle/0002_naive_the_liberteens.sql',
		'drizzle/0003_glossy_leader.sql',
		'drizzle/0004_right_sway.sql'
	]) {
		await applyMigration(migration);
	}
});

afterEach(async () => {
	await miniflare.dispose();
});

const insertChange = async (input: {
	audienceKind: 'user' | 'household';
	audienceId: string;
	mutationId: string;
	receivedAt?: string;
	tombstoneExpiresAt?: string | null;
}): Promise<number> => {
	await database
		.prepare(
			`INSERT INTO sync_changes
			 (mutation_id, actor_user_id, origin_device_id, audience_kind, audience_id, entity_kind,
			  entity_id, conflict_group, operation, resulting_revision, occurred_at, received_at,
			  payload, tombstone_expires_at)
			 VALUES (?, 'user_actor', 'device_test', ?, ?, 'recipe', ?, 'header', 'upsert', 1,
			  '2000-01-01T00:00:00.000Z', ?, ?, ?)`
		)
		.bind(
			input.mutationId,
			input.audienceKind,
			input.audienceId,
			`recipe_${input.mutationId}`,
			input.receivedAt ?? '2000-01-01T00:00:00.000Z',
			JSON.stringify({
				schemaVersion: 1,
				payload: { conflictGroups: ['header'], aggregate: {} }
			}),
			input.tombstoneExpiresAt ?? null
		)
		.run();
	const row = await database
		.prepare('SELECT seq FROM sync_changes WHERE mutation_id = ?')
		.bind(input.mutationId)
		.first<{ seq: number }>();
	return row!.seq;
};

const insertScope = async (
	audienceKind: 'user' | 'household',
	audienceId: string,
	latestSequence: number
): Promise<void> => {
	await database
		.prepare(
			`INSERT INTO sync_scope_state
			 (audience_kind, audience_id, bootstrap_generation, earliest_retained_sequence, latest_sequence)
			 VALUES (?, ?, 1, 0, ?)`
		)
		.bind(audienceKind, audienceId, latestSequence)
		.run();
};

const insertExpiringMetadata = async (
	audienceKind: 'user' | 'household',
	audienceId: string,
	sequence: number,
	suffix: string
): Promise<void> => {
	await database.batch([
		database
			.prepare(
				`INSERT INTO sync_mutation_receipts
				 (mutation_id, audience_kind, audience_id, entity_kind, entity_id, status, sequence,
				  resulting_revision, error_code, created_at, retain_until)
				 VALUES (?, ?, ?, 'recipe', ?, 'accepted', ?, 1, NULL,
				  '2000-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z')`
			)
			.bind(`receipt_${suffix}`, audienceKind, audienceId, `recipe_${suffix}`, sequence),
		database
			.prepare(
				`INSERT INTO sync_tombstones
				 (audience_kind, audience_id, entity_kind, entity_id, deletion_sequence, deleted_at,
				  expires_at, previous_server_ack)
				 VALUES (?, ?, 'recipe', ?, ?, '2000-01-01T00:00:00.000Z',
				  '2001-01-01T00:00:00.000Z', 1)`
			)
			.bind(audienceKind, audienceId, `recipe_${suffix}`, sequence)
	]);
};

describe('scheduled D1 sync retention', () => {
	test('bounds deletion, advances only affected floors, and forces stale cursors to bootstrap', async () => {
		const firstSequence = await insertChange({
			audienceKind: 'user',
			audienceId: 'user_alice',
			mutationId: 'mutation_alice_1'
		});
		const secondSequence = await insertChange({
			audienceKind: 'user',
			audienceId: 'user_alice',
			mutationId: 'mutation_alice_2'
		});
		const bobSequence = await insertChange({
			audienceKind: 'user',
			audienceId: 'user_bob',
			mutationId: 'mutation_bob'
		});
		const householdSequence = await insertChange({
			audienceKind: 'household',
			audienceId: 'org_family',
			mutationId: 'mutation_household'
		});
		await insertScope('user', 'user_alice', secondSequence);
		await insertScope('user', 'user_bob', bobSequence);
		await insertScope('household', 'org_family', householdSequence);

		const result = await pruneSyncRetentionBatch(database, {
			audienceKind: 'user',
			now: '2026-08-22T00:00:00.000Z',
			changeCutoff: '2026-05-24T00:00:00.000Z',
			batchSize: 1
		});

		expect(result).toMatchObject({ changesDeleted: 1, scopesAdvanced: 1 });
		await expect(
			database.prepare('SELECT seq FROM sync_changes WHERE seq = ?').bind(firstSequence).first()
		).resolves.toBeNull();
		await expect(
			database
				.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE audience_kind = 'household'")
				.first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
		await expect(
			database
				.prepare(
					`SELECT earliest_retained_sequence, bootstrap_generation FROM sync_scope_state
					 WHERE audience_kind = 'user' AND audience_id = 'user_alice'`
				)
				.first()
		).resolves.toEqual({
			earliest_retained_sequence: secondSequence,
			bootstrap_generation: 2
		});
		await expect(
			database
				.prepare(
					`SELECT earliest_retained_sequence, bootstrap_generation FROM sync_scope_state
					 WHERE audience_kind = 'user' AND audience_id = 'user_bob'`
				)
				.first()
		).resolves.toEqual({ earliest_retained_sequence: 0, bootstrap_generation: 1 });
		await expect(
			pullUserSync(new D1UserSyncRepository(database), 'user_alice', {
				protocolVersion: 1,
				deviceId: '01990c69-7f00-7000-8000-000000000001',
				audience: { kind: 'user', id: 'user_alice' },
				after: 0,
				limit: 10
			})
		).rejects.toMatchObject({ _tag: 'SyncBootstrapRequired', retainedFloor: secondSequence });
	});

	test('uses D1 time and prunes both audience kinds without crossing their row scopes', async () => {
		const userSequence = await insertChange({
			audienceKind: 'user',
			audienceId: 'user_alice',
			mutationId: 'mutation_user'
		});
		const householdSequence = await insertChange({
			audienceKind: 'household',
			audienceId: 'org_family',
			mutationId: 'mutation_household'
		});
		await insertScope('user', 'user_alice', userSequence);
		await insertScope('household', 'org_family', householdSequence);
		await insertExpiringMetadata('user', 'user_alice', userSequence, 'user');
		await insertExpiringMetadata('household', 'org_family', householdSequence, 'household');

		const serverNow = await readD1ServerNow(database);
		const results = await runScheduledSyncRetention(database, 10);

		expect(serverNow).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		expect(
			results.map(({ audienceKind, changesDeleted, receiptsDeleted, tombstonesDeleted }) => [
				audienceKind,
				changesDeleted,
				receiptsDeleted,
				tombstonesDeleted
			])
		).toEqual([
			['user', 1, 1, 1],
			['household', 1, 1, 1]
		]);
		await expect(
			database.prepare('SELECT COUNT(*) AS count FROM sync_changes').first<{ count: number }>()
		).resolves.toEqual({ count: 0 });
	});
});
