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
const fakeStripe = (subscriptions = new Map<string, Stripe.Subscription>()) => {
	const calls: { method: string; args: unknown[] }[] = [];
	const record =
		<R>(method: string, result: (...args: never[]) => R) =>
		async (...args: never[]) => {
			calls.push({ method, args });
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
			listPaymentMethods: async () => ({ data: [{ id: 'pm_alice' }], has_more: false })
		},
		paymentMethods: { detach: record('paymentMethods.detach', (id: string) => ({ id })) },
		checkout: {
			sessions: { create: record('checkout.create', () => ({ url: 'https://checkout.test/s' })) }
		}
	} as unknown as Stripe;
	return { stripe, subscriptions, calls };
};

const subscriptionEvent = (id: string, created: number, subId: string) =>
	({
		id,
		type: 'customer.subscription.updated',
		created,
		data: { object: { object: 'subscription', id: subId } }
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
}) =>
	database
		.prepare(
			`INSERT INTO billing_subscriptions
			 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
			  subscriber_user_id, status, current_period_end, cancel_at_period_end, updated_at)
			 VALUES (?, 'cus_family', ?, 'price_monthly', 'user_alice', ?, ?, ?, ?)`
		)
		.bind(
			householdId,
			row.subscriptionId ?? 'sub_a',
			row.status,
			row.currentPeriodEnd,
			row.cancelAtPeriodEnd ? 1 : 0,
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
			event: subscriptionEvent('evt_failed', t0, 'sub_a'),
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
		await deliver(subscriptionEvent('evt_failed', t0, 'sub_a'), iso(t0));
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		await deliver(subscriptionEvent('evt_active', t0 + 101, 'sub_a'), iso(t0 + 200));
		await deliver(invoicePaidEvent('evt_paid', t0 + 100, 'sub_a'), iso(t0 + 300));
		expect(await billingRow()).toMatchObject({
			interruption_started_at: null,
			grace_until: null,
			last_successful_payment_at: iso(t0 + 100)
		});

		// The next renewal fails 40 days later and gets its own full window.
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		await deliver(
			subscriptionEvent('evt_failed_again', t0 + 3_500_000, 'sub_a'),
			iso(t0 + 3_500_000)
		);
		expect(await billingRow()).toMatchObject({ grace_until: '2026-12-01T02:26:40.000Z' });
		await expect(authorizeHousehold(iso(t0 + 3_500_001))).resolves.toBeTruthy();
	});

	test('a paid invoice older than a newer failure keeps the newer grace window', async () => {
		const repository = new BillingRepository(database);
		const { stripe, subscriptions } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'past_due'));
		await processStripeWebhook({
			stripe,
			repository,
			event: subscriptionEvent('evt_failed', t0 + 500, 'sub_a'),
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
		await insertSubscription({ status: 'active', currentPeriodEnd: iso(t0 + 2_592_000), subscriptionId: 'sub_old' });
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

		await insertSubscription({ status: 'active', currentPeriodEnd: iso(t0 + 2_592_000), subscriptionId: 'sub_old' });
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
});

describe('billing transfer', () => {
	test('moves payment off the previous owner so their card stops renewing', async () => {
		await insertMembership('membership_bob', 'user_bob');
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const { stripe, subscriptions, calls } = fakeStripe();
		subscriptions.set('sub_a', sub('sub_a', 'active'));
		await transferBillingOwnership({
			stripe,
			repository: new BillingRepository(database),
			householdId,
			currentUserId: 'user_alice',
			newUserId: 'user_bob',
			now: '2026-09-01T00:00:00.000Z'
		});
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
});

describe('billing owner leave', () => {
	test('an owner whose cancellation is scheduled may leave', async () => {
		await insertSubscription({
			status: 'active',
			currentPeriodEnd: '2026-10-01T00:00:00.000Z',
			cancelAtPeriodEnd: true
		});
		const repository = new HouseholdAdministrationRepository(database);
		await expect(
			repository.activeBillingOwner(householdId, '2026-09-01T00:00:00.000Z')
		).resolves.toBeNull();
	});

	test('an owner of a renewing subscription must transfer or cancel first', async () => {
		await insertSubscription({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
		const repository = new HouseholdAdministrationRepository(database);
		await expect(
			repository.activeBillingOwner(householdId, '2026-09-01T00:00:00.000Z')
		).resolves.toBe('user_alice');
	});
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
			new HouseholdAdministrationRepository(database).activeBillingOwner(householdId, shortlyAfter)
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
		expect(billingCapabilityIsEnabledAt(within.capability, Date.parse(withinTolerance))).toBe(
			true
		);
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
