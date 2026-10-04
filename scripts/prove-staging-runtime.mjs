#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { open, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NotFoundException, WorkOS } from '@workos-inc/node';
import Stripe from 'stripe';
import { uuidv7 } from 'uuidv7';

import {
	disposableStripeCustomers,
	disposableStripeSubscriptions,
	disposableWorkOSOrganizations,
	disposableWorkOSUsers,
	fixtureCleanupComplete,
	mergeFixtureIds,
	mergeStripeEventDeliveries,
	requireCleanupQuiescence,
	validateLiveEnvironment
} from './lib/staging-cutover-proof.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = await validateLiveEnvironment(process.env, root);
const workos = new WorkOS(process.env.WORKOS_API_KEY, { clientId: process.env.WORKOS_CLIENT_ID });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
let nonce = randomUUID();
const password = `Maal-staging-${randomBytes(18).toString('base64url')}!9`;
let email = `maal-cutover+${nonce}@example.test`;
let organizationName = `Disposable Maal proof ${nonce}`;
let householdIdempotencyMarker = `staging-proof-${nonce}`;
const slotId = randomBytes(16).toString('hex');
const created = {
	startedAtSeconds: Math.floor(Date.now() / 1_000) - 5,
	user: null,
	householdId: null,
	userIds: [],
	householdIds: [],
	stripeEventIds: [],
	stripeEventDeliveries: [],
	customerIds: [],
	subscriptionIds: [],
	refundIds: []
};
const checks = {};
const cleanup = {
	workosUserDeleted: false,
	workosOrganizationDeleted: false,
	stripeObjectsDeleted: false,
	d1RowsRemaining: null
};
let stage = 'initialization';
let failed = null;
let failedStage = null;
const cleanupFailures = [];

if (process.argv[2] === 'cleanup') {
	await loadPrivateFixtureLedger();
	await retryCleanup();
	process.stdout.write(
		`${JSON.stringify({ result: 'passed', cleanup, privateFixtureFileRemoved: true }, null, 2)}\n`
	);
	process.exit(0);
}

await createPrivateFixtureLedger();

try {
	stage = 'configured Maal catalog verification';
	const catalog = await configuredMaalCatalog();
	checks.configuredMaalProductAndPrices = true;

	stage = 'WorkOS fixture creation';
	created.user = await workos.userManagement.createUser({
		email,
		password,
		emailVerified: true,
		firstName: 'Disposable',
		lastName: 'Maal staging proof',
		metadata: { proof: 'staging-cutover', issue: '81', nonce }
	});
	created.userIds = mergeFixtureIds(created.userIds, [created.user.id]);
	await updatePrivateFixtureLedger();
	const authentication = await workos.userManagement.authenticateWithPassword({
		email,
		password,
		session: { sealSession: true, cookiePassword: process.env.WORKOS_COOKIE_PASSWORD }
	});
	assert(authentication.sealedSession, 'WorkOS did not return a sealed staging session.');
	const session = authentication.sealedSession;

	stage = 'household projection';
	const householdResponse = await slotJson(slotId, session, 'households', {
		method: 'POST',
		headers: { 'idempotency-key': householdIdempotencyMarker },
		body: {
			name: organizationName,
			locale: 'en-US',
			timezone: 'Europe/Amsterdam'
		}
	});
	created.householdId = householdResponse.payload?.household?.householdId;
	assertSafeId(created.householdId, 'created household');
	created.householdIds = mergeFixtureIds(created.householdIds, [created.householdId]);
	await updatePrivateFixtureLedger();
	checks.householdProjected = true;

	stage = 'trial and Stripe fixture projection';
	await slotJson(slotId, session, 'billing/trial', {
		method: 'POST',
		body: { householdId: created.householdId }
	});
	checks.trialStarted = true;
	const duplicateTrial = await slotFetch(slotId, session, 'billing/trial', {
		method: 'POST',
		body: { householdId: created.householdId }
	});
	assert(!duplicateTrial.ok, 'A household accepted a second trial.');
	checks.duplicateTrialRejected = true;
	const customerPage = await stripe.customers.list({ email, limit: 10 });
	created.customerIds = customerPage.data.map(({ id }) => id);
	await updatePrivateFixtureLedger();
	assert(created.customerIds.length === 1, 'The trial did not create one Stripe customer.');
	const subscriptions = await stripe.subscriptions.list({
		customer: created.customerIds[0],
		status: 'all',
		limit: 10
	});
	const subscription = subscriptions.data.find(
		(candidate) => candidate.metadata.householdId === created.householdId
	);
	assert(subscription, 'The trial did not create a Stripe subscription.');
	created.subscriptionIds.push(subscription.id);
	await updatePrivateFixtureLedger();

	stage = 'webhook disorder and idempotency';
	const createdSecond = Math.floor(Date.now() / 1_000) + 120;
	const pastDueEvent = stripeEvent(
		'customer.subscription.updated',
		{ ...subscription, status: 'past_due' },
		createdSecond
	);
	created.stripeEventIds.push(pastDueEvent.id);
	await updatePrivateFixtureLedger();
	assert(
		(await postWebhook(pastDueEvent)).result === 'processed',
		'Past-due event was not processed.'
	);
	assert(
		(await postWebhook(pastDueEvent)).result === 'duplicate',
		'Duplicate event was processed twice.'
	);
	const staleActiveEvent = stripeEvent(
		'customer.subscription.updated',
		subscription,
		createdSecond - 60
	);
	created.stripeEventIds.push(staleActiveEvent.id);
	await updatePrivateFixtureLedger();
	assert(
		(await postWebhook(staleActiveEvent)).result === 'processed',
		'Stale event was not acknowledged.'
	);
	const graceProjection = await slotJson(
		slotId,
		session,
		`billing/status?householdId=${encodeURIComponent(created.householdId)}`
	);
	assert(
		graceProjection.capability?.state === 'grace',
		'The stale event replaced the grace projection.'
	);
	checks.webhookDisorderAndIdempotency = true;
	checks.thirtyDayGraceProjected = true;

	stage = 'paid subscription activation';
	await stripe.paymentMethods.attach('pm_card_visa', { customer: created.customerIds[0] });
	await stripe.customers.update(created.customerIds[0], {
		invoice_settings: { default_payment_method: 'pm_card_visa' }
	});
	const paidSubscription = await stripe.subscriptions.update(subscription.id, {
		default_payment_method: 'pm_card_visa',
		trial_end: 'now',
		proration_behavior: 'none',
		payment_behavior: 'error_if_incomplete',
		expand: ['latest_invoice']
	});
	assert(paidSubscription.status === 'active', 'The trial did not convert to a paid subscription.');
	assert(
		paidSubscription.items.data[0]?.price.id === catalog.monthlyPriceId,
		'The paid subscription does not use the configured monthly Maal price.'
	);
	const activeEvent = stripeEvent(
		'customer.subscription.updated',
		paidSubscription,
		createdSecond + 60
	);
	created.stripeEventIds.push(activeEvent.id);
	await updatePrivateFixtureLedger();
	assert(
		(await postWebhook(activeEvent)).result === 'processed',
		'Active event was not processed.'
	);
	checks.paidSubscriptionActivated = true;

	stage = 'stateless MCP and paid sync convergence';
	await setBillingState(created.householdId, 'active', null, null);
	const readOnlyKey = await createMcpKey(slotId, session, created.householdId, 'read-only', {
		preset: 'read_only_planner',
		scopes: ['households:read', 'recipes:read', 'meals:read', 'check_ins:read', 'food_profile:read']
	});
	await useMcpKey(readOnlyKey.key, async (client) => {
		const denied = await client.callTool({
			name: 'create_household_meal',
			arguments: {
				householdId: created.householdId,
				customMeal: {
					title: 'This write must be rejected',
					ingredients: ['water'],
					instructions: ['Do not cook.']
				},
				date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
			}
		});
		assert(denied.isError, 'A read-only MCP key performed a write.');
		assert(
			JSON.stringify(denied).includes('insufficient_scope'),
			'The read-only MCP write failed for an unexpected reason.'
		);
	});
	checks.mcpReadOnlyScopeDeniedWrite = true;
	const key = await createFullAccessKey(slotId, session, created.householdId, 'convergence');
	const toolCount = await useMcpKey(key.key, async (client) => {
		const listed = await client.listTools();
		assert(listed.tools.length > 0, 'MCP returned no tools.');
		const meal = await client.callTool({
			name: 'create_household_meal',
			arguments: {
				householdId: created.householdId,
				customMeal: {
					title: 'Disposable convergence soup',
					ingredients: ['water'],
					instructions: ['Simmer.']
				},
				date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
			}
		});
		assert(!meal.isError, 'MCP could not write the disposable meal.');
		return listed.tools.length;
	});
	checks.statelessMcpDiscoveryAndWrite = toolCount > 0;
	const sync = await slotJson(slotId, session, 'sync/pull', {
		method: 'POST',
		body: {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'household', id: created.householdId },
			after: 0,
			limit: 100
		}
	});
	assert(
		sync.changes?.some(({ aggregate }) => aggregate?.title === 'Disposable convergence soup'),
		'MCP and sync did not converge through D1.'
	);
	checks.paidSyncConverged = true;

	stage = 'MCP key revocation';
	await slotJson(slotId, session, 'mcp-keys', {
		method: 'DELETE',
		body: { keyId: key.record.id }
	});
	await expectMcpDenied(key.key, 401);
	checks.mcpRevocationAppliedNextRequest = true;

	stage = 'plan lapse and resubscription';
	const lapseKey = await createFullAccessKey(slotId, session, created.householdId, 'lapse');
	await setBillingState(
		created.householdId,
		'past_due',
		'2020-01-01T00:00:00.000Z',
		'2020-01-31T00:00:00.000Z'
	);
	const deniedSync = await pullHousehold(slotId, session, created.householdId, 1);
	assert(deniedSync.status === 403, 'Expired grace allowed paid sync.');
	await expectMcpDenied(lapseKey.key, 403);
	checks.lapseDeniedRemoteUse = true;
	await setBillingState(created.householdId, 'active', null, null);
	await useMcpKey(lapseKey.key, (client) => client.listTools());
	assert((await pullHousehold(slotId, session, created.householdId, 1)).ok, 'Sync did not resume.');
	checks.resubscriptionRestoredRemoteUse = true;

	stage = 'deletion recovery and purge';
	const expectedRefund = await computedProratedRefund(
		await stripe.subscriptions.retrieve(paidSubscription.id, {
			expand: ['latest_invoice', 'items.data.price']
		})
	);
	assert(expectedRefund.amountMinor > 0, 'The paid subscription had no prorated cash refund.');
	const deletion = await slotJson(slotId, session, 'billing/household-deletion', {
		method: 'POST',
		body: { householdId: created.householdId }
	});
	assert(deletion.state === 'recoverable', 'Deletion did not enter recovery.');
	assert(
		deletion.previewedAmountMinor === expectedRefund.amountMinor &&
			deletion.refundedAmountMinor === expectedRefund.amountMinor,
		'Deletion did not issue the computed prorated cash refund.'
	);
	assertSafeId(deletion.stripeRefundId, 'prorated refund');
	created.refundIds.push(deletion.stripeRefundId);
	await updatePrivateFixtureLedger();
	const providerRefund = await stripe.refunds.retrieve(deletion.stripeRefundId);
	assert(
		providerRefund.amount === expectedRefund.amountMinor && providerRefund.status === 'succeeded',
		'Stripe did not confirm the computed prorated cash refund.'
	);
	checks.computedProratedCashRefund = true;
	await slotJson(slotId, session, 'billing/household-deletion', {
		method: 'PATCH',
		body: { householdId: created.householdId }
	});
	const secondDeletion = await slotJson(slotId, session, 'billing/household-deletion', {
		method: 'POST',
		body: { householdId: created.householdId }
	});
	assert(secondDeletion.state === 'recoverable', 'Recovered deletion did not restart safely.');
	checks.deletionRecovery = true;
	await d1Execute(
		`UPDATE household_deletion_requests SET recoverable_until = '2020-01-01T00:00:00.000Z' WHERE household_id = ${sql(created.householdId)}`
	);
	const purge = await platformJson('/api/billing/purge', {
		method: 'POST',
		headers: { authorization: `Bearer ${process.env.BILLING_MAINTENANCE_SECRET}` }
	});
	assert(purge.purged?.includes(created.householdId), 'The expired household was not purged.');
	checks.retentionPurgeCompleted = true;
} catch (cause) {
	failed = cause instanceof Error ? cause.name : 'UnknownError';
	failedStage = stage;
} finally {
	await runCleanup();
}

if (failed) {
	throw new Error(
		`Staging runtime proof failed during ${failedStage}: ${failed}.` +
			(cleanupFailures.length > 0
				? ' Private fixture cleanup must be retried with pnpm proof:staging:cleanup.'
				: '')
	);
}
assert(
	Object.values(cleanup).every((value) => value === true || value === 0),
	'Disposable fixture cleanup was incomplete.'
);
process.stdout.write(
	`${JSON.stringify(
		{
			result: 'passed',
			deploymentLabel: config.deploymentLabel,
			checks,
			cleanup,
			fixtures: {
				workosUsersRemaining: 0,
				workosOrganizationsRemaining: 0,
				stripeCustomersRemaining: 0,
				d1RowsRemaining: 0
			},
			secretsPrinted: false,
			infrastructureIdsPrinted: false,
			personalDataPrinted: false
		},
		null,
		2
	)}\n`
);

async function createFullAccessKey(authSlotId, session, householdId, suffix) {
	return createMcpKey(authSlotId, session, householdId, suffix, {
		preset: 'full_access',
		scopes: [
			'households:read',
			'households:write',
			'recipes:read',
			'recipes:write',
			'meals:read',
			'meals:write',
			'check_ins:read',
			'check_ins:write',
			'food_profile:read',
			'food_profile:write'
		]
	});
}

async function createMcpKey(authSlotId, session, householdId, suffix, access) {
	return slotJson(authSlotId, session, 'mcp-keys', {
		method: 'POST',
		body: {
			label: `Disposable ${suffix}`,
			preset: access.preset,
			grantMode: 'selected',
			scopes: access.scopes,
			selectedHouseholdIds: [householdId]
		}
	});
}

async function useMcpKey(key, action) {
	const transport = new StreamableHTTPClientTransport(new URL(`${config.baseUrl}/mcp`), {
		fetch: async (input, init) => {
			const request =
				input instanceof Request ? new Request(input, init) : new Request(input, init);
			const headers = new Headers(request.headers);
			headers.set('authorization', `Bearer ${key}`);
			return fetch(new Request(request, { headers }));
		}
	});
	const client = new Client(
		{ name: 'maal-staging-proof', version: '1.0.0' },
		{ versionNegotiation: { mode: 'auto' } }
	);
	try {
		await client.connect(transport);
		return await action(client);
	} finally {
		await client.close().catch(() => undefined);
	}
}

async function expectMcpDenied(key, status) {
	const response = await fetch(`${config.baseUrl}/mcp`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${key}`,
			'content-type': 'application/json',
			'MCP-Protocol-Version': '2026-07-28',
			'Mcp-Method': 'server/discover'
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'server/discover',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientCapabilities': {},
					'io.modelcontextprotocol/clientInfo': {
						name: 'maal-staging-proof',
						version: '1.0.0'
					}
				}
			}
		})
	});
	assert(response.status === status, `MCP denial returned unexpected status ${response.status}.`);
}

function stripeEvent(type, object, createdAt) {
	return {
		id: `evt_maal_proof_${randomUUID().replaceAll('-', '')}`,
		object: 'event',
		api_version: '2026-06-24.dahlia',
		created: createdAt,
		data: { object },
		livemode: false,
		pending_webhooks: 0,
		request: { id: null, idempotency_key: null },
		type
	};
}

async function postWebhook(event) {
	const payload = JSON.stringify(event);
	const signature = stripe.webhooks.generateTestHeaderString({
		payload,
		secret: process.env.STRIPE_WEBHOOK_SECRET
	});
	return platformJson('/api/billing/webhook', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'stripe-signature': signature },
		rawBody: payload
	});
}

function pullHousehold(authSlotId, session, householdId, limit) {
	return slotFetch(authSlotId, session, 'sync/pull', {
		method: 'POST',
		body: {
			protocolVersion: 1,
			deviceId: uuidv7(),
			audience: { kind: 'household', id: householdId },
			after: 0,
			limit
		}
	});
}

async function setBillingState(householdId, status, interruptionStartedAt, graceUntil) {
	await d1Execute(
		`UPDATE billing_subscriptions SET status = ${sql(status)}, interruption_started_at = ${sql(interruptionStartedAt)}, grace_until = ${sql(graceUntil)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE household_id = ${sql(householdId)}`
	);
}

async function configuredMaalCatalog() {
	const product = await stripe.products.retrieve(process.env.STRIPE_PRODUCT_ID);
	assert(
		!product.deleted && product.active && product.name === 'Maal',
		'Configured product is not active Maal.'
	);
	const page = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
	const expected = new Map([
		['maal_weekly_v1', 'week'],
		['maal_monthly_v1', 'month'],
		['maal_yearly_v1', 'year']
	]);
	assert(
		page.data.length === expected.size,
		'Configured Maal must expose exactly three active prices.'
	);
	for (const price of page.data) {
		assert(
			price.lookup_key &&
				expected.get(price.lookup_key) === price.recurring?.interval &&
				price.recurring.interval_count === 1 &&
				price.recurring.usage_type === 'licensed' &&
				price.billing_scheme === 'per_unit' &&
				(price.unit_amount ?? 0) > 0,
			'Configured Maal price lookup or recurrence is invalid.'
		);
		expected.delete(price.lookup_key);
	}
	assert(expected.size === 0, 'Configured Maal price lookup keys are incomplete.');
	return {
		monthlyPriceId: page.data.find(({ lookup_key }) => lookup_key === 'maal_monthly_v1').id
	};
}

async function computedProratedRefund(subscription) {
	const item = subscription.items.data[0];
	const invoiceId = objectId(subscription.latest_invoice);
	assert(item && invoiceId, 'Paid subscription lacks a current item or invoice.');
	const invoice = await stripe.invoices.retrieve(invoiceId);
	const payments = await stripe.invoicePayments.list({
		invoice: invoiceId,
		status: 'paid',
		limit: 10
	});
	const payment = payments.data.find(({ amount_paid }) => (amount_paid ?? 0) > 0);
	assert(payment && invoice.amount_paid > 0, 'Paid invoice has no settled payment.');
	let chargeId = objectId(payment.payment.charge ?? null);
	if (!chargeId) {
		const paymentIntentId = objectId(payment.payment.payment_intent);
		assert(paymentIntentId, 'Paid invoice has no payment intent or charge.');
		chargeId = objectId((await stripe.paymentIntents.retrieve(paymentIntentId)).latest_charge);
	}
	assert(chargeId, 'Paid invoice has no refundable charge.');
	const charge = await stripe.charges.retrieve(chargeId);
	const refundableMinor = Math.max(0, charge.amount - charge.amount_refunded);
	const periodLength = Math.max(1, item.current_period_end - item.current_period_start);
	const remaining = Math.max(0, item.current_period_end - Math.floor(Date.now() / 1_000));
	return {
		amountMinor: Math.max(
			0,
			Math.min(
				Math.floor(invoice.amount_paid * Math.min(1, remaining / periodLength)),
				refundableMinor
			)
		)
	};
}

function objectId(value) {
	return typeof value === 'string' ? value : (value?.id ?? null);
}

async function slotJson(authSlotId, sealedSession, route, options = {}) {
	const response = await slotFetch(authSlotId, sealedSession, route, options);
	const value = await response.json().catch(() => null);
	if (!response.ok) throw new Error(`Staging slot route returned HTTP ${response.status}.`);
	return value;
}

function slotFetch(authSlotId, sealedSession, route, options = {}) {
	return platformFetch(`/api/auth-slots/${authSlotId}/${route}`, {
		...options,
		headers: {
			...options.headers,
			cookie: `__Secure-maal_session_${authSlotId}=${sealedSession}`
		}
	});
}

async function platformJson(path, options = {}) {
	const response = await platformFetch(path, options);
	const value = await response.json().catch(() => null);
	if (!response.ok) throw new Error(`Staging platform route returned HTTP ${response.status}.`);
	return value;
}

function platformFetch(path, options = {}) {
	const headers = new Headers(options.headers);
	let body = options.rawBody;
	if (options.body !== undefined) {
		headers.set('content-type', 'application/json');
		body = JSON.stringify(options.body);
	}
	return fetch(`${config.baseUrl}${path}`, {
		method: options.method ?? 'GET',
		headers,
		body
	});
}

async function d1Execute(command) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(
			'pnpm',
			[
				'exec',
				'wrangler',
				'd1',
				'execute',
				config.databaseName,
				'--remote',
				'--config',
				config.wranglerConfigPath,
				'--env',
				'staging',
				'--command',
				command,
				'--json'
			],
			{ cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'ignore'] }
		);
		let stdout = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
			if (stdout.length > 1_000_000) child.kill();
		});
		child.once('error', rejectPromise);
		child.once('exit', (code) => {
			if (code !== 0) rejectPromise(new Error('Remote D1 proof command failed.'));
			else {
				try {
					resolvePromise(JSON.parse(stdout));
				} catch {
					rejectPromise(new Error('Wrangler returned invalid JSON.'));
				}
			}
		});
	});
}

async function cleanupD1() {
	const userCondition = (column) => inCondition(column, created.userIds);
	const householdCondition = (column) => inCondition(column, created.householdIds);
	const audienceCondition =
		[
			created.userIds.length
				? `(audience_kind = 'user' AND ${userCondition('audience_id')})`
				: null,
			created.householdIds.length
				? `(audience_kind = 'household' AND ${householdCondition('audience_id')})`
				: null
		]
			.filter(Boolean)
			.join(' OR ') || '0';
	const eventCondition = inCondition('stripe_event_id', created.stripeEventIds);
	const customerCondition = inCondition('stripe_customer_id', created.customerIds);
	const subscriptionCondition = inCondition('stripe_subscription_id', created.subscriptionIds);
	const scopedTables = [
		['stripe_events', eventCondition],
		['sync_mutation_receipts', audienceCondition],
		['sync_tombstones', audienceCondition],
		['sync_entity_versions', audienceCondition],
		['sync_scope_state', audienceCondition],
		[
			'sync_changes',
			`${audienceCondition}${created.userIds.length ? ` OR ${userCondition('actor_user_id')}` : ''}`
		],
		['sync_devices', userCondition('workos_user_id')],
		[
			'billing_trial_claims',
			[
				created.userIds.length ? userCondition('workos_user_id') : null,
				created.householdIds.length ? householdCondition('household_id') : null,
				customerCondition,
				subscriptionCondition
			]
				.filter((condition) => condition && condition !== '0')
				.join(' OR ') || '0'
		],
		[
			'billing_audit_events',
			[
				created.userIds.length ? userCondition('actor_user_id') : null,
				created.householdIds.length ? householdCondition('household_id') : null
			]
				.filter(Boolean)
				.join(' OR ') || '0'
		],
		[
			'billing_subscriptions',
			[
				created.householdIds.length ? householdCondition('household_id') : null,
				customerCondition,
				subscriptionCondition
			]
				.filter((condition) => condition && condition !== '0')
				.join(' OR ') || '0'
		],
		['household_deletion_requests', householdCondition('household_id')],
		['mcp_key_households', householdCondition('household_id')],
		['mcp_keys', userCondition('owner_user_id')],
		['meal_check_ins', userCondition('reporter_user_id')],
		['meals', householdCondition('household_id')],
		[
			'recipes',
			[
				created.userIds.length ? userCondition('owner_user_id') : null,
				created.householdIds.length ? householdCondition('saved_from_household_id') : null
			]
				.filter(Boolean)
				.join(' OR ') || '0'
		],
		['household_appliances', householdCondition('household_id')],
		[
			'household_invites',
			[
				created.householdIds.length ? householdCondition('household_id') : null,
				created.userIds.length ? userCondition('created_by_user_id') : null
			]
				.filter(Boolean)
				.join(' OR ') || '0'
		],
		['household_membership_mutation_locks', householdCondition('household_id')],
		[
			'household_memberships',
			[
				created.householdIds.length ? householdCondition('household_id') : null,
				created.userIds.length ? userCondition('workos_user_id') : null
			]
				.filter(Boolean)
				.join(' OR ') || '0'
		],
		['food_household_aliases', householdCondition('household_id')],
		['food_household_entries', householdCondition('household_id')],
		['household_food_display_overrides', householdCondition('household_id')],
		['household_unit_display_overrides', householdCondition('household_id')],
		['unit_household_aliases', householdCondition('household_id')],
		['unit_household_entries', householdCondition('household_id')],
		['food_user_aliases', userCondition('workos_user_id')],
		['food_user_entries', userCondition('workos_user_id')],
		['unit_user_aliases', userCondition('workos_user_id')],
		['unit_user_entries', userCondition('workos_user_id')],
		['user_food_display_overrides', userCondition('workos_user_id')],
		['user_food_preferences', userCondition('workos_user_id')],
		['user_unit_display_overrides', userCondition('workos_user_id')],
		['households', householdCondition('household_id')],
		['users', userCondition('workos_user_id')]
	];

	await d1Execute(
		scopedTables.map(([table, condition]) => `DELETE FROM ${table} WHERE ${condition}`).join('; ')
	);
	const result = await d1Execute(
		`SELECT SUM(count) AS count FROM (` +
			scopedTables
				.map(([table, condition]) => `SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`)
				.join(' UNION ALL ') +
			`)`
	);
	cleanup.d1RowsRemaining = result?.[0]?.results?.[0]?.count ?? null;
}

async function cleanupStripe() {
	const fixtureCustomers = await discoverStripeFixtures();
	for (const customer of fixtureCustomers) {
		const subscriptions = await stripe.subscriptions.list({
			customer: customer.id,
			status: 'all',
			limit: 100
		});
		const fixtureSubscriptions = disposableStripeSubscriptions(subscriptions.data, fixtureMarker());
		created.subscriptionIds = mergeFixtureIds(
			created.subscriptionIds,
			fixtureSubscriptions.map(({ id }) => id)
		);
		await updatePrivateFixtureLedger();
		for (const subscription of fixtureSubscriptions) {
			if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
				await stripe.subscriptions.cancel(subscription.id, { prorate: false });
			}
		}
		await stripe.customers.del(customer.id);
	}
	const customerFacts = await Promise.all(
		created.customerIds.map(async (id) => (await stripe.customers.retrieve(id)).deleted === true)
	);
	const subscriptionFacts = await Promise.all(
		created.subscriptionIds.map(async (id) =>
			['canceled', 'incomplete_expired'].includes((await stripe.subscriptions.retrieve(id)).status)
		)
	);
	const refundFacts = await Promise.all(
		created.refundIds.map(async (id) => (await stripe.refunds.retrieve(id)).status === 'succeeded')
	);
	const remainingCustomers = disposableStripeCustomers(
		(await stripe.customers.list({ email, limit: 100 })).data,
		fixtureMarker()
	);
	cleanup.stripeObjectsDeleted =
		customerFacts.every(Boolean) &&
		subscriptionFacts.every(Boolean) &&
		refundFacts.every(Boolean) &&
		remainingCustomers.length === 0;
}

async function cleanupWorkOS() {
	await discoverWorkOSFixtures();
	for (const householdId of created.householdIds) {
		try {
			await workos.organizations.deleteOrganization(householdId);
		} catch (cause) {
			if (!(cause instanceof NotFoundException)) throw cause;
		}
	}
	const remainingOrganizations = disposableWorkOSOrganizations(
		await (await workos.organizations.listOrganizations()).autoPagination(),
		fixtureMarker()
	);
	const organizationFacts = await Promise.all(
		created.householdIds.map(async (householdId) => {
			try {
				await workos.organizations.getOrganization(householdId);
				return false;
			} catch (cause) {
				if (cause instanceof NotFoundException) return true;
				throw cause;
			}
		})
	);
	cleanup.workosOrganizationDeleted =
		organizationFacts.every(Boolean) && remainingOrganizations.length === 0;

	for (const userId of created.userIds) {
		try {
			await workos.userManagement.deleteUser(userId);
		} catch (cause) {
			if (!(cause instanceof NotFoundException)) throw cause;
		}
	}
	const remainingUsers = disposableWorkOSUsers(
		await (await workos.userManagement.listUsers({ email })).autoPagination(),
		fixtureMarker()
	);
	const userFacts = await Promise.all(
		created.userIds.map(async (userId) => {
			try {
				await workos.userManagement.getUser(userId);
				return false;
			} catch (cause) {
				if (cause instanceof NotFoundException) return true;
				throw cause;
			}
		})
	);
	cleanup.workosUserDeleted = userFacts.every(Boolean) && remainingUsers.length === 0;
}

async function discoverWorkOSFixtures() {
	const users = disposableWorkOSUsers(
		await (await workos.userManagement.listUsers({ email })).autoPagination(),
		fixtureMarker()
	);
	created.userIds = mergeFixtureIds(
		created.userIds,
		users.map(({ id }) => id)
	);
	if (!created.user && created.userIds[0]) created.user = { id: created.userIds[0] };
	await updatePrivateFixtureLedger();

	const organizations = disposableWorkOSOrganizations(
		await (await workos.organizations.listOrganizations()).autoPagination(),
		fixtureMarker()
	);
	created.householdIds = mergeFixtureIds(
		created.householdIds,
		organizations.map(({ id }) => id)
	);
	if (!created.householdId && created.householdIds[0]) {
		created.householdId = created.householdIds[0];
	}
	await updatePrivateFixtureLedger();
}

async function discoverStripeFixtures() {
	const customers = disposableStripeCustomers(
		(await stripe.customers.list({ email, limit: 100 })).data,
		fixtureMarker()
	);
	created.customerIds = mergeFixtureIds(
		created.customerIds,
		customers.map(({ id }) => id)
	);
	await updatePrivateFixtureLedger();

	for (const customer of customers) {
		const subscriptions = await stripe.subscriptions.list({
			customer: customer.id,
			status: 'all',
			limit: 100
		});
		created.subscriptionIds = mergeFixtureIds(
			created.subscriptionIds,
			disposableStripeSubscriptions(subscriptions.data, fixtureMarker()).map(({ id }) => id)
		);
		await updatePrivateFixtureLedger();
	}
	await captureStripeEventIds();
	return customers;
}

async function captureStripeEventIds() {
	let startingAfter;
	for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
		const page = await stripe.events.list({
			created: { gte: created.startedAtSeconds },
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {})
		});
		const fixtureEvents = page.data.filter(stripeEventBelongsToFixture);
		created.stripeEventIds = mergeFixtureIds(
			created.stripeEventIds,
			fixtureEvents.map(({ id }) => id)
		);
		created.stripeEventDeliveries = mergeStripeEventDeliveries(
			created.stripeEventDeliveries,
			fixtureEvents
		);
		await updatePrivateFixtureLedger();
		if (!page.has_more || page.data.length === 0) break;
		startingAfter = page.data.at(-1).id;
	}
	return created.stripeEventDeliveries.every(({ pendingWebhooks }) => pendingWebhooks === 0);
}

function stripeEventBelongsToFixture(event) {
	const object = event.data?.object ?? {};
	const ids = new Set([...created.customerIds, ...created.subscriptionIds, ...created.refundIds]);
	return [
		object.id,
		object.customer,
		object.subscription,
		object.metadata?.householdId,
		object.metadata?.workosUserId,
		object.parent?.subscription_details?.subscription
	].some(
		(value) =>
			ids.has(objectId(value)) ||
			created.householdIds.includes(value) ||
			created.userIds.includes(value)
	);
}

async function runCleanup() {
	cleanupFailures.length = 0;
	await requireCleanupQuiescence({
		cycle: cleanupObservation,
		pause: async (attempt) =>
			new Promise((resolvePromise) =>
				setTimeout(resolvePromise, Math.min(750 * 2 ** attempt, 3_000))
			),
		maxAttempts: 8
	}).catch(() => cleanupFailures.push('cleanup-quiescence'));
	if (cleanupComplete()) {
		await unlink(config.fixturePath);
	}
}

async function cleanupObservation() {
	Object.assign(cleanup, {
		workosUserDeleted: false,
		workosOrganizationDeleted: false,
		stripeObjectsDeleted: false,
		d1RowsRemaining: null
	});
	const observationFailures = [];
	await cleanupStripe().catch(() => observationFailures.push('stripe'));
	await cleanupWorkOS().catch(() => observationFailures.push('workos'));
	let providerDeliveriesComplete = false;
	await captureStripeEventIds()
		.then((complete) => {
			providerDeliveriesComplete = complete;
			if (!complete) observationFailures.push('stripe-events-pending');
		})
		.catch(() => observationFailures.push('stripe-events'));
	if (providerDeliveriesComplete) {
		await cleanupD1().catch(() => observationFailures.push('d1'));
	}
	return {
		complete: fixtureCleanupComplete(cleanup, observationFailures),
		fingerprint: JSON.stringify({
			userIds: created.userIds,
			householdIds: created.householdIds,
			customerIds: created.customerIds,
			subscriptionIds: created.subscriptionIds,
			refundIds: created.refundIds,
			stripeEventIds: created.stripeEventIds,
			stripeEventDeliveries: created.stripeEventDeliveries,
			cleanup
		})
	};
}

function cleanupComplete() {
	return fixtureCleanupComplete(cleanup, cleanupFailures);
}

function sql(value) {
	if (value === null) return 'NULL';
	return `'${String(value).replaceAll("'", "''")}'`;
}

function inCondition(column, values) {
	return values.length ? `${column} IN (${values.map(sql).join(', ')})` : '0';
}

function fixtureMarker() {
	return {
		nonce,
		email,
		organizationName,
		householdIdempotencyMarker,
		userIds: created.userIds,
		householdIds: created.householdIds,
		subscriptionIds: created.subscriptionIds
	};
}

function assertSafeId(value, label) {
	assert(typeof value === 'string' && /^[A-Za-z0-9_-]{3,200}$/.test(value), `${label} is invalid.`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function createPrivateFixtureLedger() {
	const handle = await open(config.fixturePath, 'wx', 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(privateFixtureLedger(), null, 2)}\n`);
	} finally {
		await handle.close();
	}
}

function updatePrivateFixtureLedger() {
	return writeFile(config.fixturePath, `${JSON.stringify(privateFixtureLedger(), null, 2)}\n`, {
		mode: 0o600
	});
}

function privateFixtureLedger() {
	return {
		schemaVersion: 4,
		environment: 'staging',
		startedAtSeconds: created.startedAtSeconds,
		nonce,
		email,
		organizationName,
		householdIdempotencyMarker,
		userId: created.user?.id ?? null,
		householdId: created.householdId,
		userIds: created.userIds,
		householdIds: created.householdIds,
		stripeEventIds: created.stripeEventIds,
		stripeEventDeliveries: created.stripeEventDeliveries,
		customerIds: created.customerIds,
		subscriptionIds: created.subscriptionIds,
		refundIds: created.refundIds
	};
}

async function loadPrivateFixtureLedger() {
	const value = JSON.parse(await readFile(config.fixturePath, 'utf8'));
	assert(
		[1, 2, 3, 4].includes(value?.schemaVersion) && value.environment === 'staging',
		'Fixture ledger is invalid.'
	);
	assert(
		typeof value.nonce === 'string' && typeof value.email === 'string',
		'Fixture ledger is incomplete.'
	);
	nonce = value.nonce;
	email = value.email;
	organizationName = value.organizationName ?? `Disposable Maal proof ${nonce}`;
	householdIdempotencyMarker = value.householdIdempotencyMarker ?? `staging-proof-${nonce}`;
	created.userIds = mergeFixtureIds(value.userIds, value.userId ? [value.userId] : []);
	created.householdIds = mergeFixtureIds(
		value.householdIds,
		value.householdId ? [value.householdId] : []
	);
	created.user = created.userIds[0] ? { id: created.userIds[0] } : null;
	created.startedAtSeconds = Number.isSafeInteger(value.startedAtSeconds)
		? value.startedAtSeconds
		: Math.floor(Date.now() / 1_000) - 86_400;
	created.householdId = created.householdIds[0] ?? null;
	created.stripeEventIds = Array.isArray(value.stripeEventIds) ? value.stripeEventIds : [];
	created.stripeEventDeliveries = Array.isArray(value.stripeEventDeliveries)
		? value.stripeEventDeliveries
		: [];
	created.customerIds = Array.isArray(value.customerIds) ? value.customerIds : [];
	created.subscriptionIds = Array.isArray(value.subscriptionIds) ? value.subscriptionIds : [];
	created.refundIds = Array.isArray(value.refundIds) ? value.refundIds : [];
	for (const id of [
		...created.userIds,
		...created.householdIds,
		...created.stripeEventIds,
		...created.stripeEventDeliveries.map(({ id }) => id),
		...created.customerIds,
		...created.subscriptionIds,
		...created.refundIds
	].filter(Boolean)) {
		assertSafeId(id, 'private fixture identifier');
	}
	for (const delivery of created.stripeEventDeliveries) {
		assert(
			Number.isSafeInteger(delivery.pendingWebhooks) && delivery.pendingWebhooks >= 0,
			'Fixture ledger contains an invalid Stripe delivery state.'
		);
	}
}

async function retryCleanup() {
	await runCleanup();
	assert(cleanupComplete(), 'Disposable fixture cleanup was incomplete.');
}
