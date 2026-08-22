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

import { validateLiveEnvironment } from './lib/staging-cutover-proof.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = await validateLiveEnvironment(process.env, root);
const workos = new WorkOS(process.env.WORKOS_API_KEY, { clientId: process.env.WORKOS_CLIENT_ID });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
let nonce = randomUUID();
const password = `Maal-staging-${randomBytes(18).toString('base64url')}!9`;
let email = `maal-cutover+${nonce}@example.test`;
const slotId = randomBytes(16).toString('hex');
const created = { user: null, householdId: null, stripeEventIds: [], customerIds: [] };
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
	stage = 'WorkOS fixture creation';
	created.user = await workos.userManagement.createUser({
		email,
		password,
		emailVerified: true,
		firstName: 'Disposable',
		lastName: 'Maal staging proof',
		metadata: { proof: 'staging-cutover', issue: '81', nonce }
	});
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
		headers: { 'idempotency-key': `staging-proof-${nonce}` },
		body: {
			name: `Disposable Maal proof ${nonce}`,
			locale: 'en-US',
			timezone: 'Europe/Amsterdam'
		}
	});
	created.householdId = householdResponse.payload?.household?.householdId;
	assertSafeId(created.householdId, 'created household');
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
	const deletion = await slotJson(slotId, session, 'billing/household-deletion', {
		method: 'POST',
		body: { householdId: created.householdId }
	});
	assert(deletion.state === 'recoverable', 'Deletion did not enter recovery.');
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
	await cleanupD1().catch(() => cleanupFailures.push('d1'));
	await cleanupStripe().catch(() => cleanupFailures.push('stripe'));
	await cleanupWorkOS().catch(() => cleanupFailures.push('workos'));
	if (cleanupFailures.length === 0) await unlink(config.fixturePath).catch(() => undefined);
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
	if (!created.user) return;
	for (const eventId of created.stripeEventIds) {
		await d1Execute(`DELETE FROM stripe_events WHERE stripe_event_id = ${sql(eventId)}`);
	}
	if (created.householdId) {
		await d1Execute(
			`DELETE FROM billing_audit_events WHERE household_id = ${sql(created.householdId)}; DELETE FROM household_deletion_requests WHERE household_id = ${sql(created.householdId)}; DELETE FROM billing_trial_claims WHERE household_id = ${sql(created.householdId)}; DELETE FROM households WHERE household_id = ${sql(created.householdId)}`
		);
	}
	await d1Execute(`DELETE FROM users WHERE workos_user_id = ${sql(created.user.id)}`);
	const result = await d1Execute(
		`SELECT (SELECT COUNT(*) FROM users WHERE workos_user_id = ${sql(created.user.id)}) + (SELECT COUNT(*) FROM billing_trial_claims WHERE workos_user_id = ${sql(created.user.id)}) AS count`
	);
	cleanup.d1RowsRemaining = result?.[0]?.results?.[0]?.count ?? null;
}

async function cleanupStripe() {
	const fixtureCustomers = (await stripe.customers.list({ email, limit: 100 })).data.filter(
		(customer) =>
			created.customerIds.includes(customer.id) ||
			(customer.metadata.householdId === created.householdId &&
				customer.metadata.workosUserId === created.user?.id)
	);
	for (const customer of fixtureCustomers) {
		const subscriptions = await stripe.subscriptions.list({
			customer: customer.id,
			status: 'all',
			limit: 100
		});
		for (const subscription of subscriptions.data) {
			if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
				await stripe.subscriptions.cancel(subscription.id, { prorate: false });
			}
		}
		await stripe.customers.del(customer.id);
	}
	cleanup.stripeObjectsDeleted =
		(await stripe.customers.list({ email, limit: 100 })).data.length === 0;
}

async function cleanupWorkOS() {
	if (created.householdId) {
		try {
			await workos.organizations.deleteOrganization(created.householdId);
		} catch (cause) {
			if (!(cause instanceof NotFoundException)) throw cause;
		}
		try {
			await workos.organizations.getOrganization(created.householdId);
		} catch (cause) {
			if (cause instanceof NotFoundException) cleanup.workosOrganizationDeleted = true;
			else throw cause;
		}
	}
	if (created.user) {
		try {
			await workos.userManagement.deleteUser(created.user.id);
		} catch (cause) {
			if (!(cause instanceof NotFoundException)) throw cause;
		}
		try {
			await workos.userManagement.getUser(created.user.id);
		} catch (cause) {
			if (cause instanceof NotFoundException) cleanup.workosUserDeleted = true;
			else throw cause;
		}
	}
}

function sql(value) {
	if (value === null) return 'NULL';
	return `'${String(value).replaceAll("'", "''")}'`;
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
		schemaVersion: 1,
		environment: 'staging',
		nonce,
		email,
		userId: created.user?.id ?? null,
		householdId: created.householdId,
		stripeEventIds: created.stripeEventIds,
		customerIds: created.customerIds
	};
}

async function loadPrivateFixtureLedger() {
	const value = JSON.parse(await readFile(config.fixturePath, 'utf8'));
	assert(
		value?.schemaVersion === 1 && value.environment === 'staging',
		'Fixture ledger is invalid.'
	);
	assert(
		typeof value.nonce === 'string' && typeof value.email === 'string',
		'Fixture ledger is incomplete.'
	);
	nonce = value.nonce;
	email = value.email;
	created.user = value.userId ? { id: value.userId } : null;
	created.householdId = value.householdId ?? null;
	created.stripeEventIds = Array.isArray(value.stripeEventIds) ? value.stripeEventIds : [];
	created.customerIds = Array.isArray(value.customerIds) ? value.customerIds : [];
	for (const id of [
		created.user?.id,
		created.householdId,
		...created.stripeEventIds,
		...created.customerIds
	].filter(Boolean)) {
		assertSafeId(id, 'private fixture identifier');
	}
}

async function retryCleanup() {
	await cleanupD1();
	await cleanupStripe();
	await cleanupWorkOS();
	assert(
		Object.values(cleanup).every((value) => value === true || value === 0),
		'Disposable fixture cleanup was incomplete.'
	);
	await unlink(config.fixturePath);
}
