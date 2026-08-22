import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	exportRecoverableMealCheckIns,
	restoreRecoverableMealCheckIn
} from '$lib/server/db/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	await applyD1Migrations(database, await readD1MigrationFiles());
});

afterEach(async () => miniflare.dispose());

describe('recoverable meal check-ins', () => {
	test('exports an isolated row and restores it into a valid household', async () => {
		await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
		await database.prepare("INSERT INTO households (household_id) VALUES ('org_family')").run();
		await database
			.prepare(
				`INSERT INTO meal_check_in_recovery
				 (id, household_id, reporter_user_id, meal_id, cook_time_minutes, verdict, reason,
				  created_at, updated_at, recovery_reason)
				 VALUES ('check_orphan', NULL, 'user_alice', NULL, 44, 'avoid', 'preserve me',
				         '2025-12-02T03:04:05.000Z', '2025-12-03T03:04:05.000Z',
				         'household_unresolved')`
			)
			.run();

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
	});
});
