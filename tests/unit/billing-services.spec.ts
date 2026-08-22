import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { createMaalCheckout } from '$lib/server/billing/checkout.js';
import { proratedRefundMinor } from '$lib/server/billing/deletion.js';
import { decodeMaalPrice, MAAL_PRICE_LOOKUP_KEYS } from '$lib/server/billing/pricing.js';
import {
	effectiveStripeStatus,
	loadBillingProjection,
	projectionFromStripeSubscription
} from '$lib/server/billing/subscriptions.js';

const price = (overrides: Partial<Stripe.Price> = {}): Stripe.Price =>
	({
		id: 'price_monthly',
		object: 'price',
		active: true,
		billing_scheme: 'per_unit',
		currency: 'eur',
		custom_unit_amount: null,
		livemode: false,
		lookup_key: MAAL_PRICE_LOOKUP_KEYS.month,
		metadata: {},
		nickname: null,
		product: 'prod_maal',
		recurring: {
			interval: 'month',
			interval_count: 1,
			meter: null,
			trial_period_days: null,
			usage_type: 'licensed'
		},
		tax_behavior: 'unspecified',
		tiers_mode: null,
		transform_quantity: null,
		type: 'recurring',
		unit_amount: 500,
		unit_amount_decimal: '500',
		created: 1,
		...overrides
	}) as Stripe.Price;

const subscription = (overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription =>
	({
		id: 'sub_maal',
		object: 'subscription',
		status: 'active',
		customer: 'cus_household',
		metadata: { householdId: 'org_kitchen', workosUserId: 'user_alice' },
		cancel_at_period_end: false,
		pause_collection: null,
		items: {
			object: 'list',
			data: [
				{
					id: 'si_maal',
					object: 'subscription_item',
					current_period_start: 1_777_000_000,
					current_period_end: 1_779_592_000,
					price: price()
				}
			],
			has_more: false,
			url: '/v1/subscription_items'
		},
		...overrides
	}) as Stripe.Subscription;

describe('Maal Stripe catalog', () => {
	it('accepts the three supported intervals only on the configured product and lookup keys', () => {
		expect(decodeMaalPrice(price(), 'prod_maal')).toMatchObject({
			interval: 'month',
			lookupKey: MAAL_PRICE_LOOKUP_KEYS.month
		});
		expect(decodeMaalPrice(price({ product: 'prod_other' }), 'prod_maal')).toBeNull();
		expect(decodeMaalPrice(price({ lookup_key: 'monthly' }), 'prod_maal')).toBeNull();
		expect(decodeMaalPrice(price({ unit_amount: 0 }), 'prod_maal')).toBeNull();
	});
});

describe('Stripe subscription projection', () => {
	it('keeps a recovered household disabled until Stripe projects a distinct restarted subscription', async () => {
		let stripeSubscriptionId = 'sub_cancelled';
		let stripeCancellationId: string | null = 'sub_cancelled';
		const repository = {
			subscription: async () => ({
				householdId: 'org_kitchen',
				stripeCustomerId: 'cus_household',
				stripeSubscriptionId,
				stripePriceId: 'price_monthly',
				subscriberUserId: 'user_alice',
				status: 'active' as const,
				currentPeriodEnd: '2026-09-21T12:00:00.000Z',
				cancelAtPeriodEnd: false,
				interruptionStartedAt: null,
				graceUntil: null,
				lastSuccessfulPaymentAt: null,
				lastStripeEventCreatedAt: null,
				lastStripeEventId: null,
				createdAt: '2026-08-01T12:00:00.000Z',
				updatedAt: '2026-08-01T12:00:00.000Z'
			}),
			trialClaimAvailability: async () => 'household_already_claimed' as const,
			deletionRequest: async () => ({
				householdId: 'org_kitchen',
				requesterUserId: 'user_alice',
				state: 'recovered' as const,
				stripeCancellationId,
				stripeChargeId: null,
				stripeRefundId: null,
				previewedAmountMinor: null,
				refundedAmountMinor: null,
				currency: null,
				requestedAt: '2026-08-01T12:00:00.000Z',
				recoverableUntil: null,
				purgedAt: null,
				safeErrorCode: null,
				updatedAt: '2026-08-02T12:00:00.000Z'
			})
		};
		const stripe = {
			prices: { list: async () => ({ data: [price()] }) }
		} as unknown as Stripe;
		const load = () =>
			loadBillingProjection({
				repository: repository as never,
				stripe,
				productId: 'prod_maal',
				householdId: 'org_kitchen',
				workosUserId: 'user_alice',
				now: '2026-08-22T12:00:00.000Z'
			});

		await expect(load()).resolves.toMatchObject({ capability: { state: 'disabled' } });
		stripeSubscriptionId = 'sub_restarted';
		await expect(load()).resolves.toMatchObject({ capability: { state: 'enabled' } });

		stripeCancellationId = null;
		stripeSubscriptionId = 'sub_first';
		await expect(load()).resolves.toMatchObject({ capability: { state: 'enabled' } });
		let checkoutSessions = 0;
		await expect(
			createMaalCheckout({
				repository: repository as never,
				stripe: {
					prices: { retrieve: async () => price() },
					checkout: {
						sessions: {
							create: async () => {
								checkoutSessions += 1;
								return { url: 'https://example.test/checkout' };
							}
						}
					}
				} as unknown as Stripe,
				productId: 'prod_maal',
				householdId: 'org_kitchen',
				workosUserId: 'user_alice',
				email: 'alice@example.test',
				priceId: 'price_monthly',
				origin: 'https://maal.example.test',
				idempotencyKey: 'checkout-first-subscription',
				now: '2026-08-22T12:00:00.000Z'
			})
		).rejects.toMatchObject({ _tag: 'BillingConflictError', reason: 'already_subscribed' });
		expect(checkoutSessions).toBe(0);
	});

	it('treats intentional collection pause as the same grace status as paused', () => {
		const paused = subscription({ pause_collection: { behavior: 'void', resumes_at: null } });
		expect(effectiveStripeStatus(paused)).toBe('paused');
		const projected = projectionFromStripeSubscription({
			subscription: paused,
			householdId: 'org_kitchen',
			subscriberUserId: 'user_alice',
			eventId: 'evt_pause',
			eventCreatedAt: '2026-08-21T12:00:00.000Z',
			eventReceivedAt: '2026-08-21T12:00:01.000Z',
			existing: null,
			paidPeriodSucceeded: false
		});
		expect(projected).toMatchObject({
			status: 'paused',
			interruptionStartedAt: '2026-08-21T12:00:01.000Z',
			graceUntil: '2026-09-20T12:00:01.000Z'
		});
	});

	it('keeps an interruption until an invoice-paid event confirms recovery', () => {
		const existing = {
			householdId: 'org_kitchen',
			stripeCustomerId: 'cus_household',
			stripeSubscriptionId: 'sub_maal',
			stripePriceId: 'price_monthly',
			subscriberUserId: 'user_alice',
			status: 'past_due' as const,
			currentPeriodEnd: '2026-09-21T12:00:00.000Z',
			cancelAtPeriodEnd: false,
			interruptionStartedAt: '2026-08-01T12:00:00.000Z',
			graceUntil: '2026-08-31T12:00:00.000Z',
			lastSuccessfulPaymentAt: null,
			lastStripeEventCreatedAt: '2026-08-01T12:00:00.000Z',
			lastStripeEventId: 'evt_failed',
			createdAt: '2026-08-01T12:00:00.000Z',
			updatedAt: '2026-08-01T12:00:00.000Z'
		};
		expect(
			projectionFromStripeSubscription({
				subscription: subscription(),
				householdId: 'org_kitchen',
				subscriberUserId: 'user_alice',
				eventId: 'evt_active',
				eventCreatedAt: '2026-08-10T12:00:00.000Z',
				eventReceivedAt: '2026-08-10T12:00:01.000Z',
				existing,
				paidPeriodSucceeded: false
			}).interruptionStartedAt
		).toBe('2026-08-01T12:00:00.000Z');
		expect(
			projectionFromStripeSubscription({
				subscription: subscription(),
				householdId: 'org_kitchen',
				subscriberUserId: 'user_alice',
				eventId: 'evt_paid',
				eventCreatedAt: '2026-08-10T12:00:02.000Z',
				eventReceivedAt: '2026-08-10T12:00:03.000Z',
				existing,
				paidPeriodSucceeded: true
			}).interruptionStartedAt
		).toBeNull();
	});
});

describe('cash-refund proration', () => {
	it('refunds only unused paid time and never more than the remaining charge', () => {
		expect(
			proratedRefundMinor({
				amountPaidMinor: 1_000,
				refundableMinor: 1_000,
				periodStartSeconds: 0,
				periodEndSeconds: 100,
				nowSeconds: 25
			})
		).toBe(750);
		expect(
			proratedRefundMinor({
				amountPaidMinor: 1_000,
				refundableMinor: 200,
				periodStartSeconds: 0,
				periodEndSeconds: 100,
				nowSeconds: 25
			})
		).toBe(200);
	});
});
