import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { BillingRepository, purgeExpiredHouseholds } from '$lib/server/billing/index.js';
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
	await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
	await database
		.prepare(
			`INSERT INTO households (household_id, created_by_user_id) VALUES
			 ('org_due', 'user_alice'), ('org_future', 'user_alice'), ('org_cancelling', 'user_alice')`
		)
		.run();
	await database
		.prepare(
			`INSERT INTO household_deletion_requests
			 (household_id, requester_user_id, state, refunded_amount_minor, requested_at,
			  recoverable_until, updated_at) VALUES
			 ('org_due', 'user_alice', 'recoverable', 200, '1999-12-01T00:00:00.000Z',
			  '2000-01-01T00:00:00.000Z', '1999-12-01T00:00:00.000Z'),
			 ('org_future', 'user_alice', 'recoverable', 200, '2099-12-01T00:00:00.000Z',
			  '2100-01-01T00:00:00.000Z', '2099-12-01T00:00:00.000Z'),
			 ('org_cancelling', 'user_alice', 'cancelling', NULL, '1999-12-01T00:00:00.000Z',
			  '2000-01-01T00:00:00.000Z', '1999-12-01T00:00:00.000Z')`
		)
		.run();
	await database
		.prepare(
			`INSERT INTO household_appliances (id, household_id, appliance) VALUES
			 ('appliance_due_1', 'org_due', 'oven'),
			 ('appliance_due_2', 'org_due', 'stovetop'),
			 ('appliance_due_3', 'org_due', 'microwave'),
			 ('appliance_future', 'org_future', 'oven')`
		)
		.run();
	await database
		.prepare(
			`INSERT INTO recipes (id, owner_user_id, saved_from_household_id, title)
			 VALUES ('recipe_saved', 'user_alice', 'org_due', 'Saved recipe')`
		)
		.run();
	await database
		.prepare(
			`INSERT INTO billing_trial_claims
			 (id, workos_user_id, household_id, state, reserved_at, started_at)
			 VALUES ('trial_due', 'user_alice', 'org_due', 'started',
			  '1999-01-01T00:00:00.000Z', '1999-01-01T00:00:00.000Z')`
		)
		.run();
	await database
		.prepare(
			`INSERT INTO sync_scope_state
			 (audience_kind, audience_id, bootstrap_generation, earliest_retained_sequence, latest_sequence)
			 VALUES ('household', 'org_due', 1, 0, 0), ('household', 'org_future', 1, 0, 0)`
		)
		.run();
});

afterEach(async () => {
	await miniflare.dispose();
});

describe('scheduled household purge', () => {
	test('claims only refunded expired requests and purges content in retry-safe bounded batches', async () => {
		const deletedOrganizations: string[] = [];
		const repository = new BillingRepository(database);
		const first = await purgeExpiredHouseholds({
			repository,
			now: '2026-08-22T00:00:00.000Z',
			rowBatchSize: 2,
			deleteWorkOSOrganization: async (householdId) => {
				deletedOrganizations.push(householdId);
			}
		});

		expect(first).toEqual({ purged: [], pending: ['org_due'], rowsDeleted: 2 });
		expect(deletedOrganizations).toEqual(['org_due']);
		await expect(repository.recoverHousehold('org_due', '2026-08-22T00:00:00.000Z')).resolves.toBe(
			false
		);
		await expect(
			database
				.prepare(
					"SELECT COUNT(*) AS count FROM household_appliances WHERE household_id = 'org_due'"
				)
				.first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
		await expect(repository.deletionRequest('org_future')).resolves.toMatchObject({
			state: 'recoverable'
		});
		await expect(repository.deletionRequest('org_cancelling')).resolves.toMatchObject({
			state: 'cancelling'
		});
		await database
			.prepare(
				`INSERT INTO meal_check_in_recovery
				 (id, household_id, reporter_user_id, verdict, created_at, updated_at, recovery_reason)
				 VALUES ('recovery_due', 'org_due', 'user_alice', 'repeat', ?, ?, 'household_unresolved')`
			)
			.bind('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
			.run();

		const second = await purgeExpiredHouseholds({
			repository,
			now: '2026-08-22T00:00:01.000Z',
			rowBatchSize: 10,
			deleteWorkOSOrganization: async (householdId) => {
				deletedOrganizations.push(householdId);
			}
		});
		expect(second).toMatchObject({ purged: ['org_due'], pending: [] });
		expect(second.rowsDeleted).toBe(4);
		expect(deletedOrganizations).toEqual(['org_due', 'org_due']);
		await expect(
			database.prepare("SELECT * FROM households WHERE household_id = 'org_due'").first()
		).resolves.toBeNull();
		await expect(
			database
				.prepare("SELECT saved_from_household_id FROM recipes WHERE id = 'recipe_saved'")
				.first()
		).resolves.toEqual({ saved_from_household_id: null });
		await expect(
			database.prepare("SELECT id FROM billing_trial_claims WHERE id = 'trial_due'").first()
		).resolves.toEqual({ id: 'trial_due' });
		await expect(
			database.prepare("SELECT id FROM meal_check_in_recovery WHERE id = 'recovery_due'").first()
		).resolves.toBeNull();
		await expect(
			database
				.prepare(
					"SELECT event_type FROM billing_audit_events WHERE idempotency_key = 'household:org_due:purged'"
				)
				.first()
		).resolves.toEqual({ event_type: 'household_purged_after_recovery_window' });
		await expect(
			database
				.prepare(
					"SELECT COUNT(*) AS count FROM household_appliances WHERE household_id = 'org_future'"
				)
				.first<{ count: number }>()
		).resolves.toEqual({ count: 1 });

		await expect(
			purgeExpiredHouseholds({
				repository,
				now: '2026-08-22T00:00:02.000Z',
				deleteWorkOSOrganization: vi.fn(async () => undefined)
			})
		).resolves.toEqual({ purged: [], pending: [], rowsDeleted: 0 });
	});

	test('resumes a claimed purge after WorkOS deletion fails', async () => {
		const repository = new BillingRepository(database);
		await expect(
			purgeExpiredHouseholds({
				repository,
				now: '2026-08-22T00:00:00.000Z',
				deleteWorkOSOrganization: async () => {
					throw new Error('workos unavailable');
				}
			})
		).rejects.toThrow('workos unavailable');
		await expect(repository.deletionRequest('org_due')).resolves.toMatchObject({
			state: 'requested',
			safeErrorCode: 'purge_claimed'
		});

		await expect(
			purgeExpiredHouseholds({
				repository,
				now: '2026-08-22T00:00:01.000Z',
				deleteWorkOSOrganization: async () => undefined
			})
		).resolves.toMatchObject({ purged: ['org_due'] });
	});

	test('counts meal children toward the row bound before deleting their parent', async () => {
		await database.prepare("DELETE FROM household_appliances WHERE household_id = 'org_due'").run();
		await database
			.prepare(
				`INSERT INTO meals (id, household_id, title) VALUES ('meal_due', 'org_due', 'Dinner')`
			)
			.run();
		await database
			.prepare(
				`INSERT INTO meal_ingredients (id, meal_id, line_index, original_text, source_food_label)
				 VALUES ('ingredient_1', 'meal_due', 0, 'one', 'one'),
				 ('ingredient_2', 'meal_due', 1, 'two', 'two'),
				 ('ingredient_3', 'meal_due', 2, 'three', 'three')`
			)
			.run();

		const result = await purgeExpiredHouseholds({
			repository: new BillingRepository(database),
			now: '2026-08-22T00:00:00.000Z',
			rowBatchSize: 1,
			deleteWorkOSOrganization: async () => undefined
		});

		expect(result).toEqual({ purged: [], pending: ['org_due'], rowsDeleted: 1 });
		await expect(
			database.prepare("SELECT id FROM meals WHERE id = 'meal_due'").first()
		).resolves.toEqual({ id: 'meal_due' });
		await expect(
			database
				.prepare("SELECT COUNT(*) AS count FROM meal_ingredients WHERE meal_id = 'meal_due'")
				.first<{ count: number }>()
		).resolves.toEqual({ count: 2 });
	});
});
