import { Miniflare } from 'miniflare';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	BillingRepository,
	reconcileStaleTrialClaims,
	startMaalTrial
} from '$lib/server/billing/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

let miniflare: Miniflare;
let database: D1Database;
const now = '2026-08-22T12:00:00.000Z';

const stripeSubscription = (status: Stripe.Subscription.Status = 'unpaid'): Stripe.Subscription =>
	({
		id: 'sub_used',
		object: 'subscription',
		status,
		customer: 'cus_used',
		metadata: { householdId: 'org_used', workosUserId: 'user_used' },
		cancel_at_period_end: false,
		pause_collection: null,
		items: {
			data: [
				{
					current_period_start: 1_786_000_000,
					current_period_end: 1_789_000_000,
					price: { id: 'price_maal' }
				}
			]
		}
	}) as unknown as Stripe.Subscription;

const stripePrice = (): Stripe.Price =>
	({
		id: 'price_maal',
		object: 'price',
		active: true,
		billing_scheme: 'per_unit',
		currency: 'eur',
		lookup_key: 'maal_monthly_v1',
		product: 'prod_maal',
		type: 'recurring',
		unit_amount: 500,
		recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }
	}) as Stripe.Price;

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
	test('retains a consumed claim when projection fails after Stripe created the trial', async () => {
		await expect(
			startMaalTrial({
				repository: new BillingRepository(database),
				stripe: {
					prices: { retrieve: async () => stripePrice() },
					customers: {
						create: async () => ({ id: 'cus_created' }),
						del: async () => ({ id: 'cus_created', deleted: true })
					},
					subscriptions: {
						create: async () => ({
							...stripeSubscription('trialing'),
							id: 'sub_created',
							customer: 'cus_created'
						}),
						update: async () => stripeSubscription('trialing'),
						cancel: async () => stripeSubscription('canceled')
					}
				} as unknown as Stripe,
				productId: 'prod_maal',
				householdId: 'org_projection_missing',
				workosUserId: 'user_projection_missing',
				email: 'missing@example.test',
				priceId: 'price_maal',
				trialDays: 14,
				now
			})
		).rejects.toMatchObject({ _tag: 'TrialStartError', reason: 'rolled_back' });
		await expect(
			database
				.prepare(
					`SELECT state, stripe_customer_id, stripe_subscription_id
					 FROM billing_trial_claims WHERE workos_user_id = 'user_projection_missing'`
				)
				.first()
		).resolves.toEqual({
			state: 'started',
			stripe_customer_id: 'cus_created',
			stripe_subscription_id: 'sub_created'
		});
		await expect(
			new BillingRepository(database).trialClaimAvailability('user_projection_missing', 'org_other')
		).resolves.toBe('user_already_claimed');
	});

	test('releases stale empty reservations and consumes a cleaned rollback claim once', async () => {
		const cancel = vi.fn(async () => ({ id: 'sub_used' }));
		const removeCustomer = vi.fn(async () => ({ id: 'cus_used', deleted: true }));
		const result = await reconcileStaleTrialClaims({
			repository: new BillingRepository(database),
			stripe: {
				subscriptions: { retrieve: async () => stripeSubscription(), cancel },
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
					retrieve: async () => stripeSubscription(),
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

	test('restores a live trial projection instead of deleting its Stripe resources', async () => {
		await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_used')").run();
		await database
			.prepare(
				"INSERT INTO households (household_id, created_by_user_id) VALUES ('org_used', 'user_used')"
			)
			.run();
		const cancel = vi.fn();
		const removeCustomer = vi.fn();
		const result = await reconcileStaleTrialClaims({
			repository: new BillingRepository(database),
			stripe: {
				subscriptions: { retrieve: async () => stripeSubscription('trialing'), cancel },
				customers: { del: removeCustomer }
			} as unknown as Stripe,
			now
		});
		expect(result).toEqual({ reservationsReleased: 1, rollbacksCompleted: 1, pending: 0 });
		expect(cancel).not.toHaveBeenCalled();
		expect(removeCustomer).not.toHaveBeenCalled();
		await expect(
			database.prepare("SELECT state FROM billing_trial_claims WHERE id = 'claim_rollback'").first()
		).resolves.toEqual({ state: 'started' });
		await expect(new BillingRepository(database).subscription('org_used')).resolves.toMatchObject({
			stripeSubscriptionId: 'sub_used',
			status: 'trialing'
		});
	});

	test('releases a cleaned customer-only rollback because no trial subscription existed', async () => {
		await database
			.prepare(
				`UPDATE billing_trial_claims SET stripe_subscription_id = NULL
				 WHERE id = 'claim_rollback'`
			)
			.run();
		await reconcileStaleTrialClaims({
			repository: new BillingRepository(database),
			stripe: {
				subscriptions: {},
				customers: { del: async () => ({ id: 'cus_used', deleted: true }) }
			} as unknown as Stripe,
			now
		});
		await expect(
			database.prepare("SELECT id FROM billing_trial_claims WHERE id = 'claim_rollback'").first()
		).resolves.toBeNull();
		await expect(
			new BillingRepository(database).trialClaimAvailability('user_used', 'org_used')
		).resolves.toBe('available');
	});
});
