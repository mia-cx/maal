import { Miniflare } from 'miniflare';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	BillingRepository,
	deleteHouseholdAfterRefund,
	processStripeWebhook
} from '$lib/server/billing/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

let miniflare: Miniflare;
let database: D1Database;
let repository: BillingRepository;
const now = '2026-08-22T12:00:00.000Z';

const subscription = (status: Stripe.Subscription.Status = 'active'): Stripe.Subscription =>
	({
		id: 'sub_maal',
		object: 'subscription',
		status,
		customer: 'cus_maal',
		metadata: { householdId: 'org_family', workosUserId: 'user_alice' },
		latest_invoice: 'in_maal',
		cancel_at_period_end: false,
		pause_collection: null,
		items: {
			object: 'list',
			data: [
				{
					id: 'si_maal',
					object: 'subscription_item',
					current_period_start: 1_786_000_000,
					current_period_end: 1_789_000_000,
					price: { id: 'price_maal' }
				}
			],
			has_more: false,
			url: '/v1/subscription_items'
		}
	}) as Stripe.Subscription;

const refund = (status: Stripe.Refund.Status): Stripe.Refund =>
	({
		id: 're_maal',
		object: 'refund',
		amount: 300,
		currency: 'eur',
		status,
		metadata: { householdId: 'org_family' }
	}) as Stripe.Refund;

const event = (input: {
	id: string;
	type: Stripe.Event.Type;
	object: Stripe.Event.Data.Object;
}): Stripe.Event =>
	({
		id: input.id,
		object: 'event',
		api_version: '2026-07-29.preview',
		created: 1_756_000_000,
		data: { object: input.object },
		livemode: false,
		pending_webhooks: 0,
		request: null,
		type: input.type
	}) as Stripe.Event;

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
	repository = new BillingRepository(database);
	await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
	await database
		.prepare(
			"INSERT INTO households (household_id, created_by_user_id) VALUES ('org_family', 'user_alice')"
		)
		.run();
	await database
		.prepare(
			`INSERT INTO billing_subscriptions
			 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
			  subscriber_user_id, status, current_period_end)
			 VALUES ('org_family', 'cus_maal', 'sub_maal', 'price_maal', 'user_alice', 'active',
			  '2026-09-22T12:00:00.000Z')`
		)
		.run();
});

afterEach(async () => miniflare.dispose());

describe('household deletion refund reconciliation', () => {
	test.each(['pending', 'requires_action'] as const)(
		'keeps a %s refund fail-closed until a webhook observes success',
		async (initialStatus) => {
			let currentRefund = refund(initialStatus);
			const stripe = {
				subscriptions: {
					retrieve: vi.fn(async () => subscription()),
					cancel: vi.fn(async () => subscription('canceled'))
				},
				invoices: {
					retrieve: vi.fn(async () => ({ id: 'in_maal', amount_paid: 1_000, currency: 'eur' }))
				},
				invoicePayments: {
					list: vi.fn(async () => ({
						data: [{ amount_paid: 1_000, payment: { charge: 'ch_maal' } }]
					}))
				},
				charges: {
					retrieve: vi.fn(async () => ({ id: 'ch_maal', amount: 1_000, amount_refunded: 0 }))
				},
				refunds: {
					create: vi.fn(async (request: Stripe.RefundCreateParams) => {
						currentRefund = { ...currentRefund, amount: request.amount ?? currentRefund.amount };
						return currentRefund;
					}),
					retrieve: vi.fn(async () => currentRefund)
				}
			} as unknown as Stripe;

			await expect(
				deleteHouseholdAfterRefund({
					stripe,
					repository,
					householdId: 'org_family',
					requesterUserId: 'user_alice',
					now
				})
			).resolves.toMatchObject({
				state: 'refunding',
				recoverableUntil: null,
				safeErrorCode: `refund_${initialStatus}`
			});

			currentRefund = { ...currentRefund, status: 'succeeded' };
			await expect(
				processStripeWebhook({
					stripe,
					repository,
					event: event({
						id: `evt_${initialStatus}`,
						type: 'refund.updated',
						object: currentRefund
					}),
					receivedAt: '2026-08-22T12:05:00.000Z'
				})
			).resolves.toBe('processed');
			await expect(repository.deletionRequest('org_family')).resolves.toMatchObject({
				state: 'recoverable',
				refundedAmountMinor: currentRefund.amount,
				recoverableUntil: '2026-09-21T12:05:00.000Z',
				safeErrorCode: null
			});
		}
	);

	test('keeps a failed refund outside the recovery window', async () => {
		await repository.upsertDeletionRequest({
			householdId: 'org_family',
			requesterUserId: 'user_alice',
			state: 'refunding',
			stripeRefundId: 're_maal',
			previewedAmountMinor: 300,
			currency: 'eur',
			requestedAt: now,
			updatedAt: now
		});
		const failed = refund('failed');
		await processStripeWebhook({
			stripe: { refunds: { retrieve: async () => failed } } as unknown as Stripe,
			repository,
			event: event({ id: 'evt_refund_failed', type: 'refund.failed', object: failed }),
			receivedAt: '2026-08-22T12:05:00.000Z'
		});
		await expect(repository.deletionRequest('org_family')).resolves.toMatchObject({
			state: 'failed',
			recoverableUntil: null,
			safeErrorCode: 'refund_failed'
		});
	});
});

describe('canonical Stripe webhook projection', () => {
	test('cannot restore stale service from same-second event payload ordering', async () => {
		const canonical = subscription('canceled');
		const stripe = {
			subscriptions: { retrieve: vi.fn(async () => canonical) }
		} as unknown as Stripe;
		await processStripeWebhook({
			stripe,
			repository,
			event: event({ id: 'evt_z', type: 'customer.subscription.deleted', object: canonical }),
			receivedAt: '2026-08-22T12:00:01.000Z'
		});
		await processStripeWebhook({
			stripe,
			repository,
			event: event({ id: 'evt_a', type: 'customer.subscription.updated', object: subscription() }),
			receivedAt: '2026-08-22T12:00:02.000Z'
		});
		await expect(repository.subscription('org_family')).resolves.toMatchObject({
			status: 'canceled',
			lastStripeEventId: 'evt_z'
		});
		expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
	});
});
