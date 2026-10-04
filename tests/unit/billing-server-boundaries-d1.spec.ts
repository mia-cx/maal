import type Stripe from 'stripe';
import { Miniflare } from 'miniflare';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/sync/auth.js', () => ({
	authenticateSyncSlot: async () => ({
		authSlotId: 'slot_mallory',
		workosUserId: 'user_mallory',
		activeOrganizationIds: [],
		activeMemberships: []
	})
}));

import { CURRENT_PROTOCOL_VERSION } from '$lib/domain/contracts/versions.js';
import {
	billingCapabilityIsEnabledAt,
	projectBillingCapability
} from '$lib/domain/billing/capability.js';
import {
	BillingRepository,
	createMaalCheckout,
	loadBillingProjection,
	MAAL_PRICE_LOOKUP_KEYS,
	processStripeWebhook,
	purgeExpiredHouseholds,
	reconcilePendingPayerCleanups,
	startMaalTrial,
	transferBillingOwnership
} from '$lib/server/billing/index.js';
import { HouseholdAdministrationRepository } from '$lib/server/household-administration/repository.js';
import { assertMcpKeyManagementCapability } from '$lib/server/mcp/authorization.js';
import {
	d1HouseholdSyncCapabilityAuthorizer,
	d1UserSyncCapabilityAuthorizer,
	handleUserSyncRequest
} from '$lib/server/sync/index.js';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';
import type { HouseholdPermission } from '$lib/domain/household/contracts.js';
import type { LiveWorkOSMembership } from '$lib/server/auth-slots/adapter.js';

const householdId = 'org_family';
const allPermissions: HouseholdPermission[] = [
	'meals:read',
	'meals:write',
	'households:write',
	'recipes:read'
];
const aliceLive: LiveWorkOSMembership[] = [
	{
		membershipId: 'membership_alice',
		householdId,
		householdName: 'Family',
		roleSlug: 'admin',
		permissions: allPermissions
	}
];
// Stripe event times (seconds): t0 is 2026-09-21T14:13:20Z.
const t0 = 1_790_000_000;
const iso = (seconds: number) => new Date(seconds * 1_000).toISOString();

let miniflare: Miniflare;
let database: D1Database;

const insertMembership = (membershipId: string, userId: string) =>
	database
		.prepare(
			`INSERT INTO household_memberships
			 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
			  workos_created_at, last_verified_at)
			 VALUES (?, ?, ?, 'admin', ?, 'active', ?, ?)`
		)
		.bind(
			membershipId,
			householdId,
			userId,
			JSON.stringify(allPermissions),
			'2026-01-01T00:00:00.000Z',
			'2026-01-01T00:00:00.000Z'
		)
		.run();

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
		.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice'), ('user_bob')")
		.run();
	await database
		.prepare('INSERT INTO households (household_id, created_by_user_id) VALUES (?, ?)')
		.bind(householdId, 'user_alice')
		.run();
	await insertMembership('membership_alice', 'user_alice');
});

afterEach(async () => {
	await miniflare.dispose();
});

const price = {
	id: 'price_monthly',
	object: 'price',
	active: true,
	billing_scheme: 'per_unit',
	currency: 'eur',
	lookup_key: MAAL_PRICE_LOOKUP_KEYS.month,
	product: 'prod_maal',
	recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
	type: 'recurring',
	unit_amount: 500
};

const sub = (id: string, status: Stripe.Subscription.Status): Stripe.Subscription =>
	({
		id,
		object: 'subscription',
		status,
		customer: 'cus_family',
		metadata: { householdId, workosUserId: 'user_alice' },
		cancel_at_period_end: false,
		pause_collection: null,
		items: {
			data: [{ current_period_start: t0, current_period_end: t0 + 2_592_000, price }]
		}
	}) as unknown as Stripe.Subscription;

/** A Stripe double backed by an in-memory subscription table; records every write. */
const fakeStripe = (
	subscriptions = new Map<string, Stripe.Subscription>(),
	options: {
		paymentMethods?: { id: string; created: number }[];
		failOn?:
			| 'subscriptions.update'
			| 'customers.update'
			| 'customers.listPaymentMethods'
			| 'paymentMethods.detach';
	} = {}
) => {
	const paymentMethods = new Map(
		(options.paymentMethods ?? [{ id: 'pm_alice', created: 1_700_000_000 }]).map((method) => [
			method.id,
			method
		])
	);
	const calls: { method: string; args: unknown[] }[] = [];
	const record =
		<R>(method: string, result: (...args: never[]) => R) =>
		async (...args: never[]) => {
			calls.push({ method, args });
			if (options.failOn === method) throw new Error(`stripe ${method} failed`);
			return result(...args);
		};
	const stripe = {
		subscriptions: {
			retrieve: async (id: string) => subscriptions.get(id)!,
			list: async ({ customer }: { customer: string }) => ({
				data: [...subscriptions.values()].filter((row) => row.customer === customer),
				has_more: false
			}),
			create: record('subscriptions.create', () => {
				const created = { ...sub('sub_trial', 'trialing') };
				subscriptions.set(created.id, created);
				return created;
			}),
			update: record('subscriptions.update', (id: string) => subscriptions.get(id)),
			cancel: record('subscriptions.cancel', (id: string) => {
				const cancelled = { ...subscriptions.get(id)!, status: 'canceled' as const };
				subscriptions.set(id, cancelled);
				return cancelled;
			})
		},
		refunds: { retrieve: async () => null },
		prices: { retrieve: async () => price, list: async () => ({ data: [price] }) },
		customers: {
			create: record('customers.create', () => ({ id: 'cus_family' })),
			update: record('customers.update', () => ({ id: 'cus_family' })),
			listPaymentMethods: record('customers.listPaymentMethods', () => ({
				data: [...paymentMethods.values()],
				has_more: false
			}))
		},
		paymentMethods: {
			retrieve: async (id: string) =>
				paymentMethods.has(id)
					? { ...paymentMethods.get(id)!, customer: 'cus_family' }
					: { id, customer: null },
			detach: record('paymentMethods.detach', (id: string) => {
				paymentMethods.delete(id);
				return { id };
			})
		},
		checkout: {
			sessions: { create: record('checkout.create', () => ({ url: 'https://checkout.test/s' })) }
		}
	} as unknown as Stripe;
	return { stripe, subscriptions, calls };
};

const subscriptionEvent = (
	id: string,
	created: number,
	subId: string,
	type = 'customer.subscription.updated',
	reportedStatus: Stripe.Subscription.Status | null = null
) =>
	({
		id,
		type,
		created,
		data: {
			object: {
				object: 'subscription',
				id: subId,
				status: reportedStatus,
				pause_collection: null
			}
		}
	}) as unknown as Stripe.Event;

const invoicePaidEvent = (id: string, created: number, subId: string) =>
	({
		id,
		type: 'invoice.paid',
		created,
		data: {
			object: {
				object: 'invoice',
				id: `in_${id}`,
				parent: { subscription_details: { subscription: subId } }
			}
		}
	}) as unknown as Stripe.Event;

const billingRow = () =>
	database
		.prepare('SELECT * FROM billing_subscriptions WHERE household_id = ?')
		.bind(householdId)
		.first<Record<string, unknown>>();

const insertSubscription = (row: {
	status: string;
	currentPeriodEnd: string;
	cancelAtPeriodEnd?: boolean;
	subscriptionId?: string;
	interruptionStartedAt?: string;
	graceUntil?: string;
}) =>
	database
		.prepare(
			`INSERT INTO billing_subscriptions
			 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
			  subscriber_user_id, status, current_period_end, cancel_at_period_end,
			  interruption_started_at, grace_until, updated_at)
			 VALUES (?, 'cus_family', ?, 'price_monthly', 'user_alice', ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			householdId,
			row.subscriptionId ?? 'sub_a',
			row.status,
			row.currentPeriodEnd,
			row.cancelAtPeriodEnd ? 1 : 0,
			row.interruptionStartedAt ?? null,
			row.graceUntil ?? null,
			'2026-01-01T00:00:00.000Z'
		)
		.run();

const authorizeHousehold = (now: string) =>
	d1HouseholdSyncCapabilityAuthorizer.authorize({
		database,
		workosUserId: 'user_alice',
		householdId,
		activeWorkOSMemberships: aliceLive,
		permission: 'meals:read',
		now
	});

describe('Stripe grace projection', () => {
	test('starts grace at the Stripe event time, not webhook arrival', async () => {
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		await processStripeWebhook({
			stripe,
			repository: new BillingRepository(database),
			event: subscriptionEvent(
				'evt_failed',
				t0,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			),
			receivedAt: '2026-09-23T14:13:20.000Z'
		});
		expect(await billingRow()).toMatchObject({
			interruption_started_at: iso(t0),
			grace_until: '2026-10-21T14:13:20.000Z'
		});
	});

	test('a paid invoice resets grace even when delivered after a newer subscription update', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		const deliver = (event: Stripe.Event, receivedAt: string) =>
			processStripeWebhook({ stripe, repository, event, receivedAt });

		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		await deliver(
			subscriptionEvent('evt_failed', t0, 'sub_a', 'customer.subscription.updated', 'past_due'),
			iso(t0)
		);
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		await deliver(
			subscriptionEvent('evt_active', t0 + 101, 'sub_a', 'customer.subscription.updated', 'active'),
			iso(t0 + 200)
		);
		await deliver(invoicePaidEvent('evt_paid', t0 + 100, 'sub_a'), iso(t0 + 300));
		expect(await billingRow()).toMatchObject({
			interruption_started_at: null,
			grace_until: null,
			last_successful_payment_at: iso(t0 + 100)
		});

		// The next renewal fails 40 days later and gets its own full window.
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		await deliver(
			subscriptionEvent(
				'evt_failed_again',
				t0 + 3_500_000,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			),
			iso(t0 + 3_500_000)
		);
		expect(await billingRow()).toMatchObject({ grace_until: '2026-12-01T02:26:40.000Z' });
		await expect(authorizeHousehold(iso(t0 + 3_500_001))).resolves.toBeTruthy();
	});

	test.each(['paid-then-failed', 'failed-then-paid'] as const)(
		'a payment and its failure open the same grace window in either delivery order: %s',
		async (order) => {
			const repository = new BillingRepository(database);
			const { stripe, subscriptions } = fakeStripe();
			subscriptions.set('sub_a', sub('sub_a', 'past_due'));
			const deliver = (event: Stripe.Event) =>
				processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
			const paid = invoicePaidEvent('evt_paid', t0, 'sub_a');
			const failed = subscriptionEvent(
				'evt_failed',
				t0 + 500,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			);
			for (const event of order === 'paid-then-failed' ? [paid, failed] : [failed, paid]) {
				await deliver(event);
			}
			expect(await billingRow()).toMatchObject({
				status: 'past_due',
				interruption_started_at: iso(t0 + 500),
				grace_until: iso(t0 + 500 + 30 * 86_400),
				last_successful_payment_at: iso(t0)
			});
		}
	);

	test.each(['failure-payment-failure', 'failure-failure-payment'] as const)(
		'a recovery payment after the next failure keeps that failure as the grace start: %s',
		async (order) => {
			const repository = new BillingRepository(database);
			const { stripe, subscriptions } = fakeStripe();
			subscriptions.set('sub_a', sub('sub_a', 'past_due'));
			const deliver = (event: Stripe.Event) =>
				processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
			// F0 at t0, payment at t0+500, the next failure F1 at t0+600.
			const f0 = subscriptionEvent(
				'evt_failed_0',
				t0,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			);
			const paid = invoicePaidEvent('evt_paid', t0 + 500, 'sub_a');
			const f1 = subscriptionEvent(
				'evt_failed_1',
				t0 + 600,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			);
			await deliver(f0);
			if (order === 'failure-payment-failure') {
				await deliver(paid);
				// The recovered subscription holds a provisional window, so the household
				// stays enabled while the account catches up.
				expect(await authorizeHousehold(iso(t0 + 501))).toBeTruthy();
				await deliver(f1);
			} else {
				await deliver(f1);
				await deliver(paid);
			}
			expect(await billingRow()).toMatchObject({
				status: 'past_due',
				interruption_started_at: iso(t0 + 600),
				grace_until: iso(t0 + 600 + 30 * 86_400),
				last_successful_payment_at: iso(t0 + 500)
			});
		}
	);

	test.each(['past_due', 'paused'] as const)(
		'a recovery payment restores expired grace while the next failure snapshot is pending: %s',
		async (status) => {
			const repository = new BillingRepository(database);
			const { stripe, subscriptions } = fakeStripe();
			subscriptions.set('sub_a', sub('sub_a', status));
			const paidAt = t0 + 31 * 86_400;
			const failedAt = paidAt + 100;
			const now = iso(failedAt + 100);
			const deliver = (event: Stripe.Event) =>
				processStripeWebhook({ stripe, repository, event, receivedAt: now });

			await deliver(
				subscriptionEvent('evt_failed_0', t0, 'sub_a', 'customer.subscription.updated', status)
			);
			await deliver({
				...invoicePaidEvent('evt_failed_invoice', failedAt, 'sub_a'),
				type: 'invoice.payment_failed'
			} as Stripe.Event);
			await expect(authorizeHousehold(now)).rejects.toMatchObject({
				code: 'maal_plan_required'
			});

			await deliver(invoicePaidEvent('evt_paid', paidAt, 'sub_a'));
			expect(await billingRow()).toMatchObject({
				status,
				interruption_started_at: iso(paidAt),
				grace_until: iso(paidAt + 30 * 86_400),
				last_successful_payment_at: iso(paidAt)
			});
			await expect(authorizeHousehold(now)).resolves.toBeTruthy();
			await expect(authorizeHousehold(iso(paidAt + 30 * 86_400 + 1))).rejects.toMatchObject({
				code: 'maal_plan_required'
			});

			// The stale snapshot must replace the provisional payment-time window with exact evidence.
			await deliver(
				subscriptionEvent(
					'evt_failed_1',
					failedAt,
					'sub_a',
					'customer.subscription.updated',
					status
				)
			);
			expect(await billingRow()).toMatchObject({
				status,
				interruption_started_at: iso(failedAt),
				grace_until: iso(failedAt + 30 * 86_400),
				last_successful_payment_at: iso(paidAt)
			});
			await expect(authorizeHousehold(now)).resolves.toBeTruthy();
		}
	);

	test('a stale projection cannot roll back the last payment timestamp', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		const paidAt = t0 + 31 * 86_400;
		const staleEventAt = paidAt + 100;
		const now = iso(staleEventAt + 100);
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: now });

		await deliver(
			subscriptionEvent('evt_failed_0', t0, 'sub_a', 'customer.subscription.updated', 'past_due')
		);
		await deliver(invoicePaidEvent('evt_paid', paidAt, 'sub_a'));
		expect(await billingRow()).toMatchObject({
			interruption_started_at: iso(paidAt),
			grace_until: iso(paidAt + 30 * 86_400),
			last_successful_payment_at: iso(paidAt)
		});

		// A non-payment event whose projection was read before the payment committed: the upsert
		// must keep the monotonic payment timestamp, and the recompute keeps the window at P.
		await repository.beginStripeEvent({
			id: 'evt_stale',
			type: 'invoice.created',
			receivedAt: now
		});
		await repository.commitStripeProjection(
			'evt_stale',
			{
				householdId,
				stripeCustomerId: 'cus_family',
				stripeSubscriptionId: 'sub_a',
				stripePriceId: price.id,
				subscriberUserId: 'user_alice',
				status: 'past_due',
				currentPeriodEnd: iso(t0 + 2_592_000),
				cancelAtPeriodEnd: false,
				interruptionStartedAt: iso(t0),
				graceUntil: iso(t0 + 30 * 86_400),
				lastSuccessfulPaymentAt: null,
				eventId: 'evt_stale',
				eventCreatedAt: iso(staleEventAt)
			},
			now,
			null,
			undefined,
			null
		);

		expect(await billingRow()).toMatchObject({
			interruption_started_at: iso(paidAt),
			grace_until: iso(paidAt + 30 * 86_400),
			last_successful_payment_at: iso(paidAt)
		});
		await expect(authorizeHousehold(now)).resolves.toBeTruthy();
	});

	test.each(['payment-between-failures', 'failures-before-payment'] as const)(
		'a late recovery payment restarts grace at the first failure after it: %s',
		async (order) => {
			const repository = new BillingRepository(database);
			const { stripe, subscriptions } = fakeStripe();
			subscriptions.set('sub_a', sub('sub_a', 'past_due'));
			const deliver = (event: Stripe.Event) =>
				processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
			// F0 at t0, payment at t0+500, next failure F1 at t0+600, and a much later
			// status-preserving update U at t0+86400: the new window starts at F1, not U.
			const f0 = subscriptionEvent(
				'evt_failed_0',
				t0,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			);
			const paid = invoicePaidEvent('evt_paid', t0 + 500, 'sub_a');
			const f1 = subscriptionEvent(
				'evt_failed_1',
				t0 + 600,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			);
			const update = subscriptionEvent(
				'evt_update',
				t0 + 86_400,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			);
			await deliver(f0);
			if (order === 'payment-between-failures') {
				await deliver(paid);
				await deliver(f1);
				await deliver(update);
			} else {
				await deliver(f1);
				await deliver(update);
				await deliver(paid);
			}
			expect(await billingRow()).toMatchObject({
				status: 'past_due',
				interruption_started_at: iso(t0 + 600),
				grace_until: iso(t0 + 600 + 30 * 86_400),
				last_successful_payment_at: iso(t0 + 500)
			});
		}
	);

	test('a recovery payment ignores an update that reported active while Stripe stayed past_due', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
		// F0 at t0, payment at t0+500, F1 at t0+600, and at t0+86400 an update whose payload
		// reported the subscription active (a recovery) even though the live status is still
		// past_due. Recorded by its live status it would masquerade as an interruption.
		const f0 = subscriptionEvent(
			'evt_failed_0',
			t0,
			'sub_a',
			'customer.subscription.updated',
			'past_due'
		);
		const paid = invoicePaidEvent('evt_paid', t0 + 500, 'sub_a');
		const f1 = subscriptionEvent(
			'evt_failed_1',
			t0 + 600,
			'sub_a',
			'customer.subscription.updated',
			'past_due'
		);
		const recovery = subscriptionEvent(
			'evt_recovery',
			t0 + 86_400,
			'sub_a',
			'customer.subscription.updated',
			'active'
		);
		for (const event of [f0, f1, recovery, paid]) await deliver(event);
		expect(await billingRow()).toMatchObject({
			status: 'past_due',
			interruption_started_at: iso(t0 + 600),
			grace_until: iso(t0 + 600 + 30 * 86_400),
			last_successful_payment_at: iso(t0 + 500)
		});
	});

	test('an update that reported active between failures cannot become the grace start', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
		// An update at t0+550 reporting active lands between F0 and F1. If its row recorded the
		// live past_due status, the reconstruction would move grace forward to t0+550.
		const f0 = subscriptionEvent(
			'evt_failed_0',
			t0,
			'sub_a',
			'customer.subscription.updated',
			'past_due'
		);
		const paid = invoicePaidEvent('evt_paid', t0 + 500, 'sub_a');
		const staleRecovery = subscriptionEvent(
			'evt_stale_recovery',
			t0 + 550,
			'sub_a',
			'customer.subscription.updated',
			'active'
		);
		const f1 = subscriptionEvent(
			'evt_failed_1',
			t0 + 600,
			'sub_a',
			'customer.subscription.updated',
			'past_due'
		);
		for (const event of [f0, f1, staleRecovery, paid]) await deliver(event);
		expect(await billingRow()).toMatchObject({
			status: 'past_due',
			interruption_started_at: iso(t0 + 600),
			grace_until: iso(t0 + 600 + 30 * 86_400),
			last_successful_payment_at: iso(t0 + 500)
		});
	});

	test.each(['retry-before-failure', 'retry-after-failure'] as const)(
		'an older invoice retry cannot anchor grace after a delayed recovery payment: %s',
		async (order) => {
			const repository = new BillingRepository(database);
			const { stripe, subscriptions } = fakeStripe();
			const deliver = (event: Stripe.Event) =>
				processStripeWebhook({ stripe, repository, event, receivedAt: iso(t0 + 86_500) });
			const failure = (id: string, created: number) =>
				subscriptionEvent(id, created, 'sub_a', 'customer.subscription.updated', 'past_due');
			const retry = {
				...invoicePaidEvent('evt_old_invoice_retry', t0 + 550, 'sub_a'),
				type: 'invoice.payment_failed'
			} as Stripe.Event;

			subscriptions.set('sub_a', sub('sub_a', 'past_due'));
			await deliver(failure('evt_failed_0', t0));
			if (order === 'retry-before-failure') {
				subscriptions.set('sub_a', sub('sub_a', 'active'));
				await deliver(retry);
				expect(await billingRow()).toMatchObject({ status: 'active' });
			}
			subscriptions.set('sub_a', sub('sub_a', 'past_due'));
			await deliver(failure('evt_failed_1', t0 + 86_400));
			if (order === 'retry-after-failure') await deliver(retry);
			await deliver(invoicePaidEvent('evt_paid', t0 + 500, 'sub_a'));

			expect(await billingRow()).toMatchObject({
				status: 'past_due',
				interruption_started_at: iso(t0 + 86_400),
				grace_until: iso(t0 + 86_400 + 30 * 86_400),
				last_successful_payment_at: iso(t0 + 500)
			});
			expect(
				await database
					.prepare('SELECT event_status FROM stripe_events WHERE stripe_event_id = ?')
					.bind(retry.id)
					.first()
			).toEqual({ event_status: null });
		}
	);

	test('a stale failure snapshot landing last still anchors grace at that failure', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
		// F1's failure invoice at t0+600, an interrupted update U at t0+86400, the delayed
		// recovery payment P at t0+500, then F1's subscription snapshot delivered last. The
		// snapshot is too stale to project, but its recorded row must still anchor grace at F1.
		await deliver({
			...invoicePaidEvent('evt_failed_invoice', t0 + 600, 'sub_a'),
			type: 'invoice.payment_failed'
		} as Stripe.Event);
		await deliver(
			subscriptionEvent(
				'evt_update',
				t0 + 86_400,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			)
		);
		await deliver(invoicePaidEvent('evt_paid', t0 + 500, 'sub_a'));
		await deliver(
			subscriptionEvent(
				'evt_snapshot',
				t0 + 600,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			)
		);
		expect(await billingRow()).toMatchObject({
			status: 'past_due',
			interruption_started_at: iso(t0 + 600),
			grace_until: iso(t0 + 600 + 30 * 86_400),
			last_successful_payment_at: iso(t0 + 500)
		});
	});

	test('a recovery payment opens a provisional window until the next failure lands', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });
		// F0's interruption at t0 expired long before the recovery payment P at t0+40d.
		await deliver(
			subscriptionEvent('evt_failed_0', t0, 'sub_a', 'customer.subscription.updated', 'past_due')
		);
		await deliver(invoicePaidEvent('evt_paid', t0 + 40 * 86_400, 'sub_a'));
		// No interrupted event newer than P is recorded yet, so the window is provisional at P
		// and the household keeps access while the account catches up.
		expect(await billingRow()).toMatchObject({
			status: 'past_due',
			interruption_started_at: iso(t0 + 40 * 86_400),
			grace_until: iso(t0 + 70 * 86_400),
			last_successful_payment_at: iso(t0 + 40 * 86_400)
		});
		await expect(authorizeHousehold(iso(t0 + 40 * 86_400 + 3_600))).resolves.toBeTruthy();
		// F1's failure invoice arrives before its subscription snapshot: invoice rows carry no
		// event_status, so the window stays provisional until the snapshot lands.
		await deliver({
			...invoicePaidEvent('evt_failed_1_invoice', t0 + 41 * 86_400, 'sub_a'),
			type: 'invoice.payment_failed'
		} as Stripe.Event);
		expect(await billingRow()).toMatchObject({
			interruption_started_at: iso(t0 + 40 * 86_400),
			grace_until: iso(t0 + 70 * 86_400)
		});
		await deliver(
			subscriptionEvent(
				'evt_failed_1',
				t0 + 41 * 86_400,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			)
		);
		expect(await billingRow()).toMatchObject({
			interruption_started_at: iso(t0 + 41 * 86_400),
			grace_until: iso(t0 + 71 * 86_400)
		});
	});

	test('every delivery order of the same events lands the same interruption window', async () => {
		const permutations = <T>(items: T[]): T[][] =>
			items.length < 2
				? [items]
				: items.flatMap((item, index) =>
						permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
							item,
							...rest
						])
					);
		const events = (): Stripe.Event[] => [
			subscriptionEvent('evt_failed_0', t0, 'sub_a', 'customer.subscription.updated', 'past_due'),
			invoicePaidEvent('evt_paid', t0 + 500, 'sub_a'),
			subscriptionEvent(
				'evt_failed_1',
				t0 + 600,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			),
			subscriptionEvent(
				'evt_update',
				t0 + 86_400,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			)
		];
		for (const order of permutations(events())) {
			await database.prepare('DELETE FROM billing_subscriptions').run();
			await database.prepare('DELETE FROM stripe_events').run();
			const repository = new BillingRepository(database);
			const { stripe, subscriptions } = fakeStripe();
			subscriptions.set('sub_a', sub('sub_a', 'past_due'));
			for (const event of order) {
				await processStripeWebhook({
					stripe,
					repository,
					event,
					receivedAt: iso(event.created)
				});
			}
			expect(await billingRow(), `order ${order.map((event) => event.id).join(',')}`).toMatchObject(
				{
					status: 'past_due',
					interruption_started_at: iso(t0 + 600),
					grace_until: iso(t0 + 600 + 30 * 86_400),
					last_successful_payment_at: iso(t0 + 500)
				}
			);
		}
	});

	test('a paid invoice older than a newer failure keeps the newer grace window', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		await processStripeWebhook({
			stripe,
			repository,
			event: subscriptionEvent(
				'evt_failed',
				t0 + 500,
				'sub_a',
				'customer.subscription.updated',
				'past_due'
			),
			receivedAt: iso(t0 + 500)
		});
		await processStripeWebhook({
			stripe,
			repository,
			event: invoicePaidEvent('evt_old_paid', t0, 'sub_a'),
			receivedAt: iso(t0 + 600)
		});
		expect(await billingRow()).toMatchObject({
			status: 'past_due',
			interruption_started_at: iso(t0 + 500)
		});
	});
});

describe('one live subscription per household', () => {
	test('checkout refuses while Stripe still retries the previous subscription', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions, calls } = fakeStripe();
		subscriptions.set('sub_old', sub('sub_old', 'past_due'));
		await processStripeWebhook({
			stripe,
			repository,
			event: subscriptionEvent('evt_old', t0, 'sub_old'),
			receivedAt: iso(t0)
		});
		await expect(
			createMaalCheckout({
				stripe,
				repository,
				productId: 'prod_maal',
				householdId,
				workosUserId: 'user_alice',
				email: 'alice@example.test',
				priceId: 'price_monthly',
				origin: 'https://maal.test',
				idempotencyKey: 'checkout-key-1',
				// Grace has ended, but the subscription is still open in Stripe.
				now: iso(t0 + 31 * 86_400)
			})
		).rejects.toMatchObject({ _tag: 'BillingConflictError', reason: 'already_subscribed' });
		expect(calls.filter(({ method }) => method === 'checkout.create')).toHaveLength(0);
	});

	test('events from a superseded subscription never overwrite the current one', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });

		subscriptions.set('sub_old', sub('sub_old', 'canceled'));
		await deliver(subscriptionEvent('evt_old_cancelled', t0, 'sub_old'));
		subscriptions.set('sub_new', sub('sub_new', 'active'));
		await deliver(subscriptionEvent('evt_new', t0 + 10, 'sub_new'));
		await deliver(subscriptionEvent('evt_old_late', t0 + 20, 'sub_old'));
		expect(await billingRow()).toMatchObject({
			stripe_subscription_id: 'sub_new',
			status: 'active'
		});
	});

	test('a replacement lands when Stripe confirms the projected subscription ended', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });

		// D1 still shows sub_old active: its cancellation event has not arrived yet.
		await insertSubscription({
			status: 'active',
			currentPeriodEnd: iso(t0 + 2_592_000),
			subscriptionId: 'sub_old'
		});
		subscriptions.set('sub_old', sub('sub_old', 'canceled'));
		subscriptions.set('sub_new', sub('sub_new', 'active'));
		await deliver(subscriptionEvent('evt_new', t0 + 10, 'sub_new'));
		await deliver(invoicePaidEvent('evt_new_paid', t0 + 15, 'sub_new'));
		expect(await billingRow()).toMatchObject({
			stripe_subscription_id: 'sub_new',
			status: 'active',
			last_successful_payment_at: iso(t0 + 15)
		});

		// The late cancellation for the replaced subscription must not overwrite it.
		await deliver(subscriptionEvent('evt_old_cancelled', t0 + 20, 'sub_old'));
		expect(await billingRow()).toMatchObject({
			stripe_subscription_id: 'sub_new',
			status: 'active'
		});
	});

	test('a replacement is ignored while the projected subscription is still open in Stripe', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		const deliver = (event: Stripe.Event) =>
			processStripeWebhook({ stripe, repository, event, receivedAt: iso(event.created) });

		await insertSubscription({
			status: 'active',
			currentPeriodEnd: iso(t0 + 2_592_000),
			subscriptionId: 'sub_old'
		});
		subscriptions.set('sub_old', sub('sub_old', 'active'));
		subscriptions.set('sub_new', sub('sub_new', 'active'));
		expect(await deliver(subscriptionEvent('evt_new', t0 + 10, 'sub_new'))).toBe('processed');
		expect(await billingRow()).toMatchObject({
			stripe_subscription_id: 'sub_old',
			status: 'active'
		});
	});
});

describe('household deletion and billing', () => {
	const insertDeletion = (recoverableUntil: string) =>
		database
			.prepare(
				`INSERT INTO household_deletion_requests
				 (household_id, requester_user_id, state, refunded_amount_minor, requested_at,
				  recoverable_until, updated_at)
				 VALUES (?, 'user_alice', 'recoverable', 0, ?, ?, ?)`
			)
			.bind(householdId, '2026-01-01T00:00:00.000Z', recoverableUntil, '2026-01-01T00:00:00.000Z')
			.run();

	test('a trial cannot start while the household is pending deletion', async () => {
		await insertDeletion('2099-01-01T00:00:00.000Z');
		const { stripe, calls } = fakeStripe();
		await expect(
			startMaalTrial({
				stripe,
				repository: new BillingRepository(database),
				productId: 'prod_maal',
				householdId,
				workosUserId: 'user_alice',
				email: 'alice@example.test',
				trialDays: 30,
				now: '2026-09-01T00:00:00.000Z'
			})
		).rejects.toMatchObject({ reason: 'household_deletion_pending' });
		expect(calls).toHaveLength(0);
	});

	test('purge cancels any subscription still open in Stripe', async () => {
		await insertDeletion('2026-02-01T00:00:00.000Z');
		await insertSubscription({ status: 'trialing', currentPeriodEnd: '2026-03-01T00:00:00.000Z' });
		const { stripe, subscriptions, calls } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'trialing'));
		await purgeExpiredHouseholds({
			repository: new BillingRepository(database),
			stripe,
			now: '2026-02-02T00:00:00.000Z',
			deleteWorkOSOrganization: async () => undefined
		});
		expect(calls.filter(({ method }) => method === 'subscriptions.cancel')).toMatchObject([
			{ args: ['sub_a', expect.anything(), expect.anything()] }
		]);
		expect(subscriptions.get('sub_a')?.status).toBe('canceled');
	});

	test('a webhook delivered after the household was purged finishes quietly', async () => {
		await insertDeletion('2026-02-01T00:00:00.000Z');
		await insertSubscription({ status: 'trialing', currentPeriodEnd: '2026-03-01T00:00:00.000Z' });
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'trialing'));
		await purgeExpiredHouseholds({
			repository: new BillingRepository(database),
			stripe,
			now: '2026-02-02T00:00:00.000Z',
			deleteWorkOSOrganization: async () => undefined
		});

		// The cancellation webhook Stripe sends after the purge must not try to project onto a
		// billing row whose household no longer exists.
		const result = await processStripeWebhook({
			stripe,
			repository: new BillingRepository(database),
			event: subscriptionEvent(
				'evt_late_cancel',
				t0 + 100,
				'sub_a',
				'customer.subscription.deleted'
			),
			receivedAt: iso(t0 + 100)
		});
		expect(result).toBe('processed');
		expect(await billingRow()).toBeNull();
		expect(
			await database
				.prepare("SELECT state FROM stripe_events WHERE stripe_event_id = 'evt_late_cancel'")
				.first<{ state: string }>()
		).toMatchObject({ state: 'processed' });
	});
});

describe('billing transfer', () => {
	const transferInput = (stripe: Stripe) => ({
		stripe,
		repository: new BillingRepository(database),
		householdId,
		currentUserId: 'user_alice',
		newUserId: 'user_bob',
		now: '2026-09-01T00:00:00.000Z'
	});
	const auditEvents = () =>
		database
			.prepare('SELECT event_type, idempotency_key FROM billing_audit_events ORDER BY rowid')
			.all<{ event_type: string; idempotency_key: string }>();

	test('moves payment off the previous owner so their card stops renewing', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, subscriptions, calls } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		const result = await transferBillingOwnership(transferInput(stripe));
		expect(result.payerCleanup).toBe('completed');
		expect(await billingRow()).toMatchObject({ subscriber_user_id: 'user_bob' });
		const byMethod = (method: string) =>
			calls.filter((call) => call.method === method).map(({ args }) => args);
		expect(byMethod('paymentMethods.detach')).toEqual([['pm_alice']]);
		expect(byMethod('customers.update')).toMatchObject([
			[
				'cus_family',
				{
					email: '',
					name: '',
					invoice_settings: { default_payment_method: '' },
					metadata: { workosUserId: 'user_bob' }
				}
			]
		]);
		expect(byMethod('subscriptions.update')).toMatchObject([
			['sub_a', { default_payment_method: '', metadata: { workosUserId: 'user_bob' } }]
		]);
	});

	test('transferring to yourself is rejected before any Stripe or D1 write', async () => {
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, calls } = fakeStripe();
		await expect(
			transferBillingOwnership({ ...transferInput(stripe), newUserId: 'user_alice' })
		).rejects.toMatchObject({ reason: 'target_must_differ' });
		expect(calls).toHaveLength(0);
		expect(await billingRow()).toMatchObject({ subscriber_user_id: 'user_alice' });
	});

	test('a failed payment method listing leaves D1 and Stripe untouched', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, subscriptions, calls } = fakeStripe(new Map(), {
			failOn: 'customers.listPaymentMethods'
		});
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		await expect(transferBillingOwnership(transferInput(stripe))).rejects.toThrow(
			'stripe customers.listPaymentMethods failed'
		);
		expect(await billingRow()).toMatchObject({ subscriber_user_id: 'user_alice' });
		expect(
			calls.some(({ method }) => method === 'subscriptions.update' || method === 'customers.update')
		).toBe(false);
	});

	test('a failed subscription update restores the D1 owner without touching the customer', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, subscriptions, calls } = fakeStripe(new Map(), {
			failOn: 'subscriptions.update'
		});
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		await expect(transferBillingOwnership(transferInput(stripe))).rejects.toThrow(
			'stripe subscriptions.update failed'
		);
		expect(await billingRow()).toMatchObject({ subscriber_user_id: 'user_alice' });
		expect(calls.some(({ method }) => method === 'customers.update')).toBe(false);
	});

	test('a failed customer update restores the subscription and the D1 owner', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, subscriptions, calls } = fakeStripe(new Map(), {
			failOn: 'customers.update'
		});
		subscriptions.set('sub_a', {
			...sub('sub_a', 'active'),
			default_payment_method: 'pm_alice'
		} as Stripe.Subscription);
		await expect(transferBillingOwnership(transferInput(stripe))).rejects.toThrow(
			'stripe customers.update failed'
		);
		expect(await billingRow()).toMatchObject({ subscriber_user_id: 'user_alice' });
		expect(
			calls.filter(({ method }) => method === 'subscriptions.update').map(({ args }) => args)
		).toEqual([
			[
				'sub_a',
				{
					default_payment_method: '',
					metadata: { householdId, workosUserId: 'user_bob' }
				}
			],
			[
				'sub_a',
				{
					default_payment_method: 'pm_alice',
					metadata: { householdId, workosUserId: 'user_alice' }
				}
			]
		]);
	});

	test('a failed detach leaves ownership transferred and maintenance finishes the cleanup', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, subscriptions } = fakeStripe(new Map(), {
			paymentMethods: [{ id: 'pm_old', created: 1_700_000_000 }],
			failOn: 'paymentMethods.detach'
		});
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		const result = await transferBillingOwnership({
			...transferInput(stripe),
			now: iso(t0)
		});
		expect(result.payerCleanup).toBe('pending');
		expect(await billingRow()).toMatchObject({ subscriber_user_id: 'user_bob' });
		expect((await auditEvents()).results).toContainEqual({
			event_type: 'billing_payer_cleanup_pending',
			idempotency_key: `payer-cleanup:sub_a:user_bob:${iso(t0)}`
		});

		// Maintenance detaches the recorded methods only: the card the new owner attached
		// after the transfer survives even though its Stripe creation time is older.
		const retry = fakeStripe(new Map(), {
			paymentMethods: [
				{ id: 'pm_old', created: 1_700_000_000 },
				{ id: 'pm_new', created: 1_600_000_000 }
			]
		});
		const cleanup = await reconcilePendingPayerCleanups({
			repository: new BillingRepository(database),
			stripe: retry.stripe,
			now: iso(t0 + 60)
		});
		expect(cleanup).toEqual({ completed: 1, pending: 0 });
		expect(
			retry.calls.filter(({ method }) => method === 'paymentMethods.detach').map(({ args }) => args)
		).toEqual([['pm_old']]);
		expect(await retry.stripe.paymentMethods.retrieve('pm_new')).toMatchObject({
			customer: 'cus_family'
		});
		expect((await auditEvents()).results).toContainEqual({
			event_type: 'billing_payer_cleanup_completed',
			idempotency_key: `payer-cleanup-completed:sub_a:user_bob:${iso(t0)}`
		});
	});

	test('a repeat transfer to the same owner gets its own cleanup record', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const subscriptions = () => new Map([['sub_a', sub('sub_a', 'active')]]);
		// Alice -> Bob -> Alice -> Bob; the earlier completed cleanups must not mask the
		// last transfer's pending record when its detach fails.
		for (const [from, to, now] of [
			['user_alice', 'user_bob', iso(t0)],
			['user_bob', 'user_alice', iso(t0 + 60)]
		] as const) {
			const { stripe } = fakeStripe(subscriptions());
			await transferBillingOwnership({
				...transferInput(stripe),
				currentUserId: from,
				newUserId: to,
				now
			});
		}
		const failing = fakeStripe(subscriptions(), { failOn: 'paymentMethods.detach' });
		const result = await transferBillingOwnership({
			...transferInput(failing.stripe),
			now: iso(t0 + 120)
		});
		expect(result.payerCleanup).toBe('pending');

		const cleanup = await reconcilePendingPayerCleanups({
			repository: new BillingRepository(database),
			stripe: fakeStripe(subscriptions()).stripe,
			now: iso(t0 + 240)
		});
		expect(cleanup).toEqual({ completed: 1, pending: 0 });
		expect((await auditEvents()).results).toContainEqual({
			event_type: 'billing_payer_cleanup_completed',
			idempotency_key: `payer-cleanup-completed:sub_a:user_bob:${iso(t0 + 120)}`
		});
	});
});

describe('billing owner leave', () => {
	test('an owner whose cancellation is scheduled may leave', async () => {
		await insertSubscription({
			status: 'active',
			currentPeriodEnd: '2026-10-01T00:00:00.000Z',
			cancelAtPeriodEnd: true
		});
		const repository = new HouseholdAdministrationRepository(database);
		await expect(repository.activeBillingOwner(householdId)).resolves.toBeNull();
	});

	test('an owner of a renewing subscription must transfer or cancel first', async () => {
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const repository = new HouseholdAdministrationRepository(database);
		await expect(repository.activeBillingOwner(householdId)).resolves.toBe('user_alice');
	});

	test.each(['past_due', 'paused', 'unpaid'] as const)(
		'an owner of an open %s subscription cannot strand it even after grace expires',
		async (status) => {
			await insertSubscription({
				status,
				currentPeriodEnd: '2026-01-15T00:00:00.000Z',
				interruptionStartedAt: '2026-01-15T00:00:00.000Z',
				graceUntil: '2026-02-14T00:00:00.000Z'
			});
			const repository = new HouseholdAdministrationRepository(database);
			await expect(repository.activeBillingOwner(householdId)).resolves.toBe('user_alice');
		}
	);

	test.each(['canceled', 'incomplete_expired'] as const)(
		'an owner of a %s subscription may leave',
		async (status) => {
			await insertSubscription({ status, currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
			const repository = new HouseholdAdministrationRepository(database);
			await expect(repository.activeBillingOwner(householdId)).resolves.toBeNull();
		}
	);
});

describe('renewal webhook tolerance', () => {
	const periodEnd = '2026-10-01T00:00:00.000Z';
	const shortlyAfter = '2026-10-01T00:10:00.000Z';
	const hoursAfter = '2026-10-01T03:00:00.000Z';

	test('keeps an active subscription enabled briefly past period end while the renewal lands', async () => {
		await insertSubscription({ status: 'active', currentPeriodEnd: periodEnd });
		await expect(authorizeHousehold(shortlyAfter)).resolves.toBeTruthy();
		await expect(
			d1UserSyncCapabilityAuthorizer.authorize({
				database,
				workosUserId: 'user_alice',
				activeWorkOSMemberships: aliceLive,
				permission: 'recipes:read',
				now: shortlyAfter
			})
		).resolves.toBeTruthy();
		await expect(
			assertMcpKeyManagementCapability({
				database,
				ownerUserId: 'user_alice',
				liveMemberships: aliceLive,
				now: shortlyAfter
			})
		).resolves.toBeUndefined();
		await expect(
			new HouseholdAdministrationRepository(database).activeBillingOwner(householdId)
		).resolves.toBe('user_alice');
	});

	test('disables an active subscription once the tolerance has passed', async () => {
		await insertSubscription({ status: 'active', currentPeriodEnd: periodEnd });
		await expect(authorizeHousehold(hoursAfter)).rejects.toMatchObject({
			code: 'maal_plan_required'
		});
	});
});

describe('client capability renewal tolerance', () => {
	const periodEnd = '2026-10-01T00:00:00.000Z';
	const withinTolerance = '2026-10-01T00:10:00.000Z';
	const pastTolerance = '2026-10-01T01:01:00.000Z';
	const input = {
		householdId,
		status: 'active' as const,
		subscriberUserId: 'user_alice',
		stripePriceId: 'price_monthly',
		currentPeriodEnd: periodEnd,
		cancelAtPeriodEnd: false,
		interruptionStartedAt: null,
		graceUntil: null
	};

	test('extends validUntil one hour past the projected period end', () => {
		const capability = projectBillingCapability(input, withinTolerance);
		expect(capability.validUntil).toBe('2026-10-01T01:00:00.000Z');
		expect(billingCapabilityIsEnabledAt(capability, Date.parse(withinTolerance))).toBe(true);
		expect(billingCapabilityIsEnabledAt(capability, Date.parse(pastTolerance))).toBe(false);
	});

	test('loadBillingProjection matches the server authorizer on both sides of the tolerance', async () => {
		await insertSubscription({ status: 'active', currentPeriodEnd: periodEnd });
		const repository = new BillingRepository(database);
		const { stripe } = fakeStripe();
		const load = (now: string) =>
			loadBillingProjection({
				repository,
				stripe,
				productId: 'prod_maal',
				householdId,
				workosUserId: 'user_alice',
				now
			});

		const within = await load(withinTolerance);
		expect(billingCapabilityIsEnabledAt(within.capability, Date.parse(withinTolerance))).toBe(true);
		await expect(authorizeHousehold(withinTolerance)).resolves.toBeTruthy();

		const past = await load(pastTolerance);
		expect(billingCapabilityIsEnabledAt(past.capability, Date.parse(pastTolerance))).toBe(false);
		await expect(authorizeHousehold(pastTolerance)).rejects.toMatchObject({
			code: 'maal_plan_required'
		});
	});
});

describe('household sync gates', () => {
	const call = (operation: 'push' | 'backfill', body: unknown) => {
		const text = JSON.stringify(body);
		return handleUserSyncRequest(
			{
				cookies: {} as never,
				params: { slot: 'slot_mallory' },
				platform: { env: { DB: database } } as never,
				request: new Request('https://maal.test/sync', {
					method: 'POST',
					headers: { 'content-type': 'application/json', 'content-length': String(text.length) },
					body: text
				})
			},
			operation
		);
	};

	test('an empty push or backfill still requires membership', async () => {
		const deviceId = uuidv7();
		const audience = { kind: 'household', id: householdId };
		const push = await call('push', {
			protocolVersion: CURRENT_PROTOCOL_VERSION,
			deviceId,
			audience,
			baseCursor: null,
			mutations: []
		});
		const backfill = await call('backfill', {
			protocolVersion: CURRENT_PROTOCOL_VERSION,
			deviceId,
			audience,
			checkpoint: {
				entityKind: 'meal',
				lastAggregateId: null,
				processedCount: 0,
				priorityBoundary: null
			},
			mutations: []
		});
		expect([push.status, backfill.status]).toEqual([403, 403]);
	});
});
