import { Miniflare } from 'miniflare';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { BillingRepository, reconcileStaleTrialClaims } from '$lib/server/billing/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

let miniflare: Miniflare;
let database: D1Database;
const now = '2026-08-22T12:00:00.000Z';

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
	await database
		.prepare(
			`INSERT INTO billing_trial_claims
			 (id, workos_user_id, household_id, state, stripe_customer_id, stripe_subscription_id,
			  reserved_at, updated_at) VALUES
			 ('claim_stale', 'user_stale', 'org_stale', 'reserved', NULL, NULL, ?, ?),
			 ('claim_fresh', 'user_fresh', 'org_fresh', 'reserved', NULL, NULL, ?, ?),
			 ('claim_rollback', 'user_used', 'org_used', 'rollback_pending', 'cus_used', 'sub_used', ?, ?)`
		)
		.bind(
			'2026-08-22T09:00:00.000Z',
			'2026-08-22T09:00:00.000Z',
			'2026-08-22T11:30:00.000Z',
			'2026-08-22T11:30:00.000Z',
			'2026-08-22T09:00:00.000Z',
			'2026-08-22T09:00:00.000Z'
		)
		.run();
});

afterEach(async () => miniflare.dispose());

describe('scheduled trial maintenance', () => {
	test('releases stale empty reservations and consumes a cleaned rollback claim once', async () => {
		const cancel = vi.fn(async () => ({ id: 'sub_used' }));
		const removeCustomer = vi.fn(async () => ({ id: 'cus_used', deleted: true }));
		const result = await reconcileStaleTrialClaims({
			repository: new BillingRepository(database),
			stripe: {
				subscriptions: { cancel },
				customers: { del: removeCustomer }
			} as unknown as Stripe,
			now
		});

		expect(result).toEqual({ reservationsReleased: 1, rollbacksCompleted: 1, pending: 0 });
		await expect(
			database.prepare("SELECT id FROM billing_trial_claims WHERE id = 'claim_stale'").first()
		).resolves.toBeNull();
		await expect(
			database.prepare("SELECT state FROM billing_trial_claims WHERE id = 'claim_fresh'").first()
		).resolves.toEqual({ state: 'reserved' });
		await expect(
			database
				.prepare("SELECT state, started_at FROM billing_trial_claims WHERE id = 'claim_rollback'")
				.first()
		).resolves.toEqual({ state: 'started', started_at: '2026-08-22T09:00:00.000Z' });
		expect(cancel).toHaveBeenCalledWith(
			'sub_used',
			{},
			expect.objectContaining({ idempotencyKey: expect.stringContaining('claim_rollback') })
		);
		expect(removeCustomer).toHaveBeenCalledOnce();

		await expect(
			new BillingRepository(database).trialClaimAvailability('user_used', 'org_unused')
		).resolves.toBe('user_already_claimed');
	});

	test('keeps rollback pending when Stripe cleanup fails so maintenance can retry', async () => {
		const result = await reconcileStaleTrialClaims({
			repository: new BillingRepository(database),
			stripe: {
				subscriptions: {
					cancel: async () => {
						throw new Error('stripe unavailable');
					}
				},
				customers: { del: async () => ({ id: 'cus_used', deleted: true }) }
			} as unknown as Stripe,
			now
		});
		expect(result).toEqual({ reservationsReleased: 1, rollbacksCompleted: 0, pending: 1 });
		await expect(
			database.prepare("SELECT state FROM billing_trial_claims WHERE id = 'claim_rollback'").first()
		).resolves.toEqual({ state: 'rollback_pending' });
	});
});
