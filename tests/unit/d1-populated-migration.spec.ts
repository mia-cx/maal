import { readFile } from 'node:fs/promises';

import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	exportRecoverableMealCheckIns,
	restoreRecoverableMealCheckIn
} from '$lib/server/db/index.js';

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
});

afterEach(async () => miniflare.dispose());

describe('populated D1 migration chain', () => {
	test('repairs authoritative check-in ownership and preserves an unresolvable historical row for export', async () => {
		for (const migration of [
			'drizzle/0000_quick_hitman.sql',
			'drizzle/0001_long_mysterio.sql',
			'drizzle/0002_naive_the_liberteens.sql',
			'drizzle/0003_glossy_leader.sql'
		]) {
			await applyMigration(migration);
		}
		await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
		await database.prepare("INSERT INTO households (household_id) VALUES ('org_family')").run();
		await database
			.prepare(
				`INSERT INTO meal_check_ins
				 (id, household_id, reporter_user_id, meal_id, cook_time_minutes, verdict, reason,
				  created_at, updated_at)
				 VALUES
				 ('check_repair', NULL, 'user_alice', NULL, 31, 'repeat', 'repair me', ?, ?),
				 ('check_orphan', NULL, 'user_alice', NULL, 44, 'avoid', 'preserve me', ?, ?)`
			)
			.bind(
				'2026-01-02T03:04:05.000Z',
				'2026-01-03T03:04:05.000Z',
				'2025-12-02T03:04:05.000Z',
				'2025-12-03T03:04:05.000Z'
			)
			.run();
		await database
			.prepare(
				`INSERT INTO sync_entity_versions
				 (audience_kind, audience_id, entity_kind, entity_id, conflict_group, revision,
				  last_sequence, winning_occurred_at, winning_origin_device_id, winning_mutation_id)
				 VALUES ('household', 'org_family', 'meal_check_in', 'check_repair', 'response', 1,
				         1, '2026-01-03T03:04:05.000Z', 'device_legacy', 'mutation_legacy')`
			)
			.run();

		await applyMigration('drizzle/0004_right_sway.sql');
		await applyMigration('drizzle/0005_needy_khan.sql');

		await expect(
			database.prepare("SELECT * FROM meal_check_ins WHERE id = 'check_repair'").first()
		).resolves.toMatchObject({ household_id: 'org_family', reason: 'repair me' });
		await expect(
			database.prepare("SELECT * FROM meal_check_ins WHERE id = 'check_orphan'").first()
		).resolves.toBeNull();
		await expect(
			database.prepare("SELECT * FROM meal_check_in_recovery WHERE id = 'check_orphan'").first()
		).resolves.toMatchObject({
			id: 'check_orphan',
			household_id: null,
			reporter_user_id: 'user_alice',
			meal_id: null,
			cook_time_minutes: 44,
			verdict: 'avoid',
			reason: 'preserve me',
			created_at: '2025-12-02T03:04:05.000Z',
			updated_at: '2025-12-03T03:04:05.000Z',
			recovery_reason: 'household_unresolved'
		});
		await expect(exportRecoverableMealCheckIns(database)).resolves.toMatchObject({
			schemaVersion: 1,
			records: [
				{
					id: 'check_orphan',
					householdId: null,
					reporterUserId: 'user_alice',
					mealId: null,
					cookTimeMinutes: 44,
					verdict: 'avoid',
					reason: 'preserve me',
					createdAt: '2025-12-02T03:04:05.000Z',
					updatedAt: '2025-12-03T03:04:05.000Z',
					recoveryReason: 'household_unresolved'
				}
			]
		});
		await expect(
			restoreRecoverableMealCheckIn(database, 'check_orphan', 'org_family')
		).resolves.toBe(true);
		await expect(
			database.prepare("SELECT * FROM meal_check_in_recovery WHERE id = 'check_orphan'").first()
		).resolves.toBeNull();
		await expect(
			database.prepare("SELECT * FROM meal_check_ins WHERE id = 'check_orphan'").first()
		).resolves.toMatchObject({ household_id: 'org_family', reason: 'preserve me' });
		const householdColumn = (
			await database.prepare('PRAGMA table_info(meals)').all<{ name: string; notnull: number }>()
		).results.find(({ name }) => name === 'household_id');
		expect(householdColumn?.notnull).toBe(1);
	});
});
