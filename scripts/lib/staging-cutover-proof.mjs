import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { STAGING_PROOF_EVENT } from '../../src/lib/server/observability/staging-proof.ts';

export { classifyPermittedFreeUseCall } from '../../src/lib/server/observability/staging-proof.ts';

export const STAGING_CONFIRMATION = 'create-and-remove-disposable-staging-fixtures';

/** The committed config that deploy, migrations, and the runtime proof's D1 commands all use. */
export const STAGING_WRANGLER_CONFIG = 'wrangler.jsonc';

const requiredLiveSettings = [
	'MAAL_STAGING_BASE_URL',
	'MAAL_STAGING_DEPLOYMENT_LABEL',
	'MAAL_STAGING_DATABASE_NAME',
	// Wrangler sees several accounts and the committed config names none.
	'CLOUDFLARE_ACCOUNT_ID',
	'MAAL_STAGING_FIXTURE_FILE',
	'MAAL_STAGING_EVIDENCE_FILE',
	'WORKOS_API_KEY',
	'WORKOS_CLIENT_ID',
	'WORKOS_COOKIE_PASSWORD',
	'STRIPE_SECRET_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'STRIPE_PRODUCT_ID',
	'BILLING_MAINTENANCE_SECRET'
];

export const contractProofFiles = [
	'tests/unit/staging-cutover-proof.spec.ts',
	'tests/unit/d1-reset-generator.spec.ts',
	'tests/unit/d1-reset-rehearsal-d1.spec.ts',
	'tests/unit/auth-slots.spec.ts',
	'tests/unit/auth-slot-proof-evidence.spec.ts',
	'tests/unit/billing-capability.spec.ts',
	'tests/unit/billing-services.spec.ts',
	'tests/unit/billing-local.spec.ts',
	'tests/unit/household-retention.spec.ts',
	'tests/unit/user-sync.spec.ts',
	'tests/unit/user-sync-d1.spec.ts',
	'tests/unit/household-sync.spec.ts',
	'tests/unit/household-sync-d1.spec.ts',
	'tests/unit/scheduled-retention.spec.ts',
	'tests/unit/mcp-authorization.spec.ts',
	'tests/unit/mcp-contract.spec.ts',
	'tests/unit/mcp-domain-d1.spec.ts',
	'tests/unit/mcp-protocol.spec.ts',
	'tests/unit/mcp-tools.spec.ts'
];

const productionHostnames = new Set(['maal.mia.cx', 'maal.is', 'www.maal.is']);

export const validateStagingOrigin = (value) => {
	if (!value?.trim()) throw new Error('MAAL_STAGING_BASE_URL is required.');
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	) {
		throw new Error('MAAL_STAGING_BASE_URL must be a clean HTTPS staging origin.');
	}
	if (productionHostnames.has(url.hostname)) {
		throw new Error('Staging proof refuses the production Maal hostname.');
	}
	return url.origin;
};

export const stableAuthCallback = (baseUrl) => {
	const callback = new URL('/api/auth/callback', validateStagingOrigin(baseUrl));
	if (/auth-slots|slot/i.test(callback.pathname)) {
		throw new Error('The WorkOS redirect URI must not encode an auth slot.');
	}
	return callback.href;
};

export const validateLiveEnvironment = async (environment, repositoryRoot) => {
	const missing = requiredLiveSettings.filter((name) => !environment[name]?.trim());
	if (environment.MAAL_STAGING_PROOF_CONFIRM !== STAGING_CONFIRMATION) {
		missing.unshift(`MAAL_STAGING_PROOF_CONFIRM=${STAGING_CONFIRMATION}`);
	}
	if (missing.length > 0) {
		throw new Error(`Staging proof is blocked. Missing operator inputs: ${missing.join(', ')}`);
	}

	if (!environment.WORKOS_API_KEY.startsWith('sk_test_')) {
		throw new Error('Staging proof refuses a WorkOS key that is not a staging sk_test_ key.');
	}
	if (!environment.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
		throw new Error('Staging proof refuses a Stripe key that is not a test-mode sk_test_ key.');
	}
	if (!environment.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
		throw new Error('Staging proof requires the test endpoint Stripe webhook secret.');
	}
	if (environment.WORKOS_COOKIE_PASSWORD.length < 32) {
		throw new Error('WORKOS_COOKIE_PASSWORD must contain at least 32 characters.');
	}
	if (environment.MAAL_STAGING_DATABASE_NAME !== 'maal-staging') {
		throw new Error('Staging proof only accepts MAAL_STAGING_DATABASE_NAME=maal-staging.');
	}
	if (!/^[0-9a-f]{32}$/.test(environment.CLOUDFLARE_ACCOUNT_ID)) {
		throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character Cloudflare account ID.');
	}

	const baseUrl = validateStagingOrigin(environment.MAAL_STAGING_BASE_URL);
	if (!/^[-a-zA-Z0-9_.]{1,80}$/.test(environment.MAAL_STAGING_DEPLOYMENT_LABEL)) {
		throw new Error('MAAL_STAGING_DEPLOYMENT_LABEL must be a short non-secret label.');
	}

	const configPath = resolve(repositoryRoot, STAGING_WRANGLER_CONFIG);
	await validateWranglerStagingConfig(configPath, new URL(baseUrl).hostname);
	const fixturePath = privatePath(
		environment.MAAL_STAGING_FIXTURE_FILE,
		repositoryRoot,
		'MAAL_STAGING_FIXTURE_FILE'
	);
	const evidencePath = privatePath(
		environment.MAAL_STAGING_EVIDENCE_FILE,
		repositoryRoot,
		'MAAL_STAGING_EVIDENCE_FILE'
	);
	if (fixturePath === evidencePath) {
		throw new Error('Fixture and sanitized evidence files must use different private paths.');
	}
	return {
		baseUrl,
		authCallbackUrl: stableAuthCallback(baseUrl),
		deploymentLabel: environment.MAAL_STAGING_DEPLOYMENT_LABEL,
		databaseName: environment.MAAL_STAGING_DATABASE_NAME,
		wranglerConfigPath: configPath,
		fixturePath,
		evidencePath,
		providerModes: { workos: 'staging', stripe: 'test', cloudflare: 'staging' }
	};
};

const validateWranglerStagingConfig = async (path, stagingHostname) => {
	let configuration;
	try {
		configuration = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		throw new Error(`${STAGING_WRANGLER_CONFIG} must exist and contain JSON-compatible JSONC.`);
	}
	const staging = configuration?.env?.staging;
	if (configuration?.main !== 'src/worker.ts') {
		throw new Error('Wrangler main must be src/worker.ts.');
	}
	const compatibilityFlags = staging?.compatibility_flags ?? configuration?.compatibility_flags;
	if (!Array.isArray(compatibilityFlags) || !compatibilityFlags.includes('nodejs_compat')) {
		throw new Error('Wrangler staging requires the nodejs_compat compatibility flag.');
	}
	if (staging?.name !== 'maal-staging') {
		throw new Error('Wrangler staging Worker name must be maal-staging.');
	}
	if (staging.vars?.MAAL_PROOF_TELEMETRY !== 'staging-only') {
		throw new Error('Wrangler staging must enable staging-only proof telemetry.');
	}
	if (
		!Array.isArray(staging.routes) ||
		staging.routes.length !== 1 ||
		staging.routes[0]?.pattern !== stagingHostname ||
		staging.routes[0].custom_domain !== true
	) {
		throw new Error('Wrangler staging must route only the staging origin as its custom domain.');
	}
	assertNoSecretVars(configuration);
	const databases = staging.d1_databases;
	const database =
		Array.isArray(databases) && databases.length === 1 && databases[0]?.binding === 'DB'
			? databases[0]
			: null;
	if (
		database?.database_name !== 'maal-staging' ||
		database.migrations_dir !== 'drizzle' ||
		!validInfrastructureUuid(database.database_id)
	) {
		throw new Error('Wrangler staging DB binding must name the existing maal-staging D1 database.');
	}
	const rateLimits = staging.ratelimits;
	const rateLimit =
		Array.isArray(rateLimits) &&
		rateLimits.length === 1 &&
		rateLimits[0]?.name === 'RECIPE_URL_RATE_LIMIT'
			? rateLimits[0]
			: null;
	if (
		!rateLimit ||
		!/^\d*[1-9]\d*$/.test(rateLimit.namespace_id) ||
		rateLimit.simple?.limit !== 10 ||
		rateLimit.simple?.period !== 60
	) {
		throw new Error('Wrangler staging rate-limit binding is invalid.');
	}
	if (
		!Array.isArray(staging.triggers?.crons) ||
		staging.triggers.crons.length !== 1 ||
		staging.triggers.crons[0] !== '17 3 * * *'
	) {
		throw new Error('Wrangler staging cron must be exactly 17 3 * * *.');
	}
	const assets = staging.assets ?? configuration.assets;
	if (assets?.binding !== 'ASSETS' || assets.directory !== '.svelte-kit/cloudflare') {
		throw new Error('Wrangler staging assets binding is invalid.');
	}
	const observability = staging.observability ?? configuration.observability;
	if (
		observability?.enabled !== true ||
		observability.logs?.head_sampling_rate !== 1 ||
		observability.traces?.enabled !== true ||
		observability.traces?.head_sampling_rate !== 0.01
	) {
		throw new Error('Wrangler staging observability settings are invalid.');
	}
};

const assertNoSecretVars = (configuration) => {
	for (const [scope, vars] of [
		['root', configuration?.vars],
		...Object.entries(configuration?.env ?? {}).map(([name, value]) => [name, value?.vars])
	]) {
		if (!vars || typeof vars !== 'object' || Array.isArray(vars)) continue;
		for (const [name, value] of Object.entries(vars)) {
			if (
				/(?:secret|password|api[_-]?key|client[_-]?id|product[_-]?id|webhook|token)/i.test(name) ||
				(typeof value === 'string' && /^(?:sk_|whsec_|prod_|client_|mk_)/.test(value))
			) {
				throw new Error(`Wrangler ${scope} vars must not contain secret or provider values.`);
			}
		}
	}
};

const validInfrastructureUuid = (value) =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) &&
	value !== '00000000-0000-0000-0000-000000000000';

const privatePath = (value, repositoryRoot, name) => {
	if (!isAbsolute(value)) throw new Error(`${name} must be an absolute private temporary path.`);
	const path = resolve(value);
	const repositoryRelative = relative(repositoryRoot, path);
	if (!repositoryRelative.startsWith('..') || repositoryRelative === '') {
		throw new Error(`${name} must stay outside the repository.`);
	}
	return path;
};

/** Bounds the wait for Workers Logs to ingest a free-use run: 12 polls, 15 seconds apart. */
export const FREE_USE_LOG_POLL = { maxAttempts: 12, pauseMs: 15_000 };
/** The events view returns at most this many events, so a full page cannot prove completeness. */
const TELEMETRY_EVENT_LIMIT = 2000;
/** Starts the log window before the run to absorb clock skew between this host and Cloudflare. */
const LOG_WINDOW_SKEW_MS = 60_000;

export const telemetryQueryUrl = (accountId) =>
	`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`;

/**
 * The Workers Observability events query for one free-use run: `staging_proof_request` events
 * tagged with the deployment label and the run label, from just before the run until `now`.
 * `dry` keeps the ad-hoc query out of the account's saved queries.
 */
export const buildFreeUseLogQuery = ({ deploymentLabel, proofRun, startedAt, now }) => ({
	queryId: `maal-staging-free-use-${proofRun}`,
	dry: true,
	view: 'events',
	limit: TELEMETRY_EVENT_LIMIT,
	timeframe: { from: new Date(startedAt).getTime() - LOG_WINDOW_SKEW_MS, to: now },
	parameters: {
		filterCombination: 'and',
		filters: [
			{ key: 'event', operation: 'eq', type: 'string', value: STAGING_PROOF_EVENT },
			{ key: 'proofLabel', operation: 'eq', type: 'string', value: deploymentLabel },
			{ key: 'proofRun', operation: 'eq', type: 'string', value: proofRun }
		]
	}
});

/**
 * Judges one query response against the run. It counts only events whose own fields match the
 * run, so a filter the API ignores cannot let another run's events in, and it returns counts only.
 * A content or auth event with a D1 open fails the run; so does logging fewer events than the
 * browser saw traced responses.
 */
export const evaluateFreeUseLogs = (
	response,
	{ deploymentLabel, proofRun, tracedRequestCount }
) => {
	if (!response?.result) throw new Error('Workers Logs returned no query result.');
	const rawEvents = response.result.events?.events ?? [];
	if (rawEvents.length >= TELEMETRY_EVENT_LIMIT) {
		throw new Error(
			'Workers Logs returned a full page; the free-use run cannot be proven complete.'
		);
	}
	const events = rawEvents
		.map(({ source }) => (typeof source === 'string' ? parseJsonObject(source) : source))
		.filter(
			(source) =>
				source?.event === STAGING_PROOF_EVENT &&
				source.proofLabel === deploymentLabel &&
				source.proofRun === proofRun
		);
	// Anything but an explicit `false` counts as a D1 open, so a malformed event fails closed.
	const d1Opens = (routeClasses) =>
		events.filter(({ d1Opened, routeClass }) => d1Opened !== false && routeClasses(routeClass))
			.length;
	const observed = {
		tracedRequestCount: safeInteger(tracedRequestCount) ?? 0,
		eventCount: events.length,
		contentD1OpenCount: d1Opens((routeClass) => !['auth', 'billing', 'admin'].includes(routeClass)),
		authD1OpenCount: d1Opens((routeClass) => routeClass === 'auth'),
		billingAdminD1OpenCount: d1Opens((routeClass) => ['billing', 'admin'].includes(routeClass))
	};
	const checks = {
		allTracedRequestsLogged:
			observed.tracedRequestCount > 0 && observed.eventCount >= observed.tracedRequestCount,
		zeroContentD1Opens: observed.contentD1OpenCount === 0,
		zeroAuthD1Opens: observed.authD1OpenCount === 0
	};
	return {
		result: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
		checks,
		observed
	};
};

/**
 * Polls Workers Logs until every traced request of the run is logged or the bound runs out, then
 * returns the last evaluation. A D1 open on a content or auth route ends the poll at once.
 */
export const pollFreeUseLogs = async ({
	query,
	pause,
	run,
	maxAttempts = FREE_USE_LOG_POLL.maxAttempts
}) => {
	for (let attempt = 1; ; attempt += 1) {
		const evaluation = evaluateFreeUseLogs(await query(), run);
		const { allTracedRequestsLogged, ...d1Checks } = evaluation.checks;
		const settled = allTracedRequestsLogged || !Object.values(d1Checks).every(Boolean);
		if (settled || attempt >= maxAttempts) {
			return { ...evaluation, observed: { ...evaluation.observed, pollAttempts: attempt } };
		}
		await pause(attempt);
	}
};

const parseJsonObject = (value) => {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

export const fixtureCleanupComplete = (cleanup, failures = []) =>
	Array.isArray(failures) &&
	failures.length === 0 &&
	cleanup !== null &&
	typeof cleanup === 'object' &&
	Object.values(cleanup).length > 0 &&
	Object.values(cleanup).every((value) => value === true || value === 0);

export const mergeFixtureIds = (current, discovered) =>
	[...new Set([...(current ?? []), ...(discovered ?? [])])].sort();

export const mergeStripeEventDeliveries = (current, discovered) => {
	const deliveries = new Map((current ?? []).map((event) => [event.id, event]));
	for (const event of discovered ?? []) {
		deliveries.set(event.id, {
			id: event.id,
			pendingWebhooks:
				Number.isSafeInteger(event.pending_webhooks) && event.pending_webhooks >= 0
					? event.pending_webhooks
					: null
		});
	}
	return [...deliveries.values()].sort((left, right) => left.id.localeCompare(right.id));
};

export const disposableWorkOSUsers = (users, marker) =>
	(users ?? []).filter(
		(user) =>
			user?.email === marker.email &&
			user.metadata?.proof === 'staging-cutover' &&
			user.metadata?.nonce === marker.nonce
	);

export const disposableWorkOSOrganizations = (organizations, marker) =>
	(organizations ?? []).filter((organization) => organization?.name === marker.organizationName);

export const disposableStripeCustomers = (customers, marker) => {
	const householdIds = new Set(marker.householdIds ?? []);
	const userIds = new Set(marker.userIds ?? []);
	return (customers ?? []).filter(
		(customer) =>
			customer?.email === marker.email &&
			householdIds.has(customer.metadata?.householdId) &&
			userIds.has(customer.metadata?.workosUserId)
	);
};

export const disposableStripeSubscriptions = (subscriptions, marker) => {
	const householdIds = new Set(marker.householdIds ?? []);
	const userIds = new Set(marker.userIds ?? []);
	const knownIds = new Set(marker.subscriptionIds ?? []);
	return (subscriptions ?? []).filter(
		(subscription) =>
			knownIds.has(subscription?.id) ||
			(householdIds.has(subscription?.metadata?.householdId) &&
				userIds.has(subscription?.metadata?.workosUserId))
	);
};

export const requireCleanupQuiescence = async ({ cycle, pause, maxAttempts = 8 }) => {
	let previousFingerprint = null;
	let stableObservations = 0;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const observation = await cycle(attempt);
		if (observation.complete === true) {
			stableObservations =
				observation.fingerprint === previousFingerprint ? stableObservations + 1 : 1;
			previousFingerprint = observation.fingerprint;
			if (stableObservations >= 2) return observation;
		} else {
			previousFingerprint = null;
			stableObservations = 0;
		}
		if (attempt + 1 < maxAttempts) await pause(attempt);
	}
	throw new Error('Disposable fixture cleanup did not reach two stable zero-remnant observations.');
};

export const WEBKIT_SKIP_REASON = 'operator-declared-host-cannot-launch-webkit';

/**
 * Picks the deployed auth-slot Playwright projects for `proof:staging live`. With `skipWebkit`
 * (the operator's `--skip-webkit`), WebKit projects drop out and the result names them for the
 * evidence.
 */
export const selectAuthSlotProjects = (projects, { skipWebkit }) => {
	const skippedProjects = skipWebkit
		? projects
				.filter((project) => project.use?.defaultBrowserType === 'webkit')
				.map(({ name }) => name)
		: [];
	return {
		projects: projects.map(({ name }) => name).filter((name) => !skippedProjects.includes(name)),
		skippedProjects,
		skipReason: skippedProjects.length > 0 ? WEBKIT_SKIP_REASON : null
	};
};

export const summarizeAuthEvidence = (value) => ({
	result: value?.result === 'passed' ? 'passed' : 'failed',
	aliceCookieBytes: safeInteger(value?.aliceCookieBytes),
	bobCookieBytes: safeInteger(value?.bobCookieBytes),
	aliceSurvivedBobLogin: optionalCheck(value?.aliceSurvivedBobLogin),
	bobSurvivedAliceRefresh: optionalCheck(value?.bobSurvivedAliceRefresh),
	bobSurvivedAliceRevocation: optionalCheck(value?.bobSurvivedAliceRevocation),
	cleanup: cleanupSummary(value?.cleanup)
});

export const assertPassingAuthProof = (name, value, requiredChecks) => {
	if (value?.result !== 'passed') throw new Error(`Staging proof ${name} did not pass.`);
	for (const check of requiredChecks) {
		if (value[check] !== true) throw new Error(`Staging proof ${name} did not prove ${check}.`);
	}
	assertProviderCleanup(name, value.cleanup);
};

export const assertPassingBillingProof = (name, value) => {
	if (value?.result !== 'passed' || !allChecksPassed(value.checks)) {
		throw new Error(`Staging proof ${name} did not pass every check.`);
	}
	if (value.cleanup?.failedCount !== 0) {
		throw new Error(`Staging proof ${name} did not clean up every fixture.`);
	}
};

export const assertPassingBooleanProof = (name, value) => {
	if (value?.result !== 'passed' || !allChecksPassed(value.checks)) {
		throw new Error(`Staging proof ${name} did not pass every check.`);
	}
	for (const [field, item] of Object.entries(value.cleanup ?? {})) {
		if ((typeof item === 'boolean' && !item) || (field.endsWith('Remaining') && item !== 0)) {
			throw new Error(`Staging proof ${name} did not clean up every fixture.`);
		}
	}
};

export const summarizeBillingEvidence = (value) => ({
	result: value?.result === 'passed' ? 'passed' : 'failed',
	mode: {
		stripe: value?.mode?.stripe === 'test' ? 'test' : 'unknown',
		workos: value?.mode?.workos === 'staging' ? 'staging' : 'unknown'
	},
	checks: booleanChecks(value?.checks),
	cleanup: cleanupSummary(value?.cleanup)
});

export const summarizeBooleanProof = (value) => ({
	result: value?.result === 'passed' ? 'passed' : 'failed',
	checks: booleanChecks(value?.checks),
	cleanup:
		value?.cleanup && typeof value.cleanup === 'object'
			? Object.fromEntries(
					Object.entries(value.cleanup).filter(
						([name, item]) =>
							/^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(name) &&
							(typeof item === 'boolean' || (Number.isSafeInteger(item) && item >= 0))
					)
				)
			: {},
	observed:
		value?.observed && typeof value.observed === 'object'
			? Object.fromEntries(
					Object.entries(value.observed).filter(
						([name, item]) =>
							/^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(name) && Number.isSafeInteger(item) && item >= 0
					)
				)
			: {}
});

export const safeCommandEvidence = ({ name, result, startedAt, finishedAt }) => ({
	name,
	result: result === 'passed' ? 'passed' : 'failed',
	startedAt: utc(startedAt),
	finishedAt: utc(finishedAt)
});

export const writeSanitizedEvidence = async (path, evidence) => {
	const absolutePath = resolve(path);
	await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
	const handle = await open(absolutePath, 'wx', 0o600);
	try {
		await writeFile(handle, `${JSON.stringify(evidence, null, 2)}\n`);
	} finally {
		await handle.close();
	}
	return absolutePath;
};

const cleanupSummary = (value) => ({
	attempted: safeInteger(value?.attempted),
	verifiedDeleted: safeInteger(value?.verifiedDeleted),
	remainingDisposableUsers: safeInteger(value?.remainingDisposableUsers),
	failedCount: Array.isArray(value?.failed) ? value.failed.length : 0,
	verifiedAtUtc: typeof value?.verifiedAtUtc === 'string' ? utc(value.verifiedAtUtc) : null
});

const booleanChecks = (value) =>
	value && typeof value === 'object'
		? Object.fromEntries(
				Object.entries(value)
					.filter(
						([name, check]) =>
							/^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(name) && typeof check === 'boolean'
					)
					.map(([name, check]) => [name, check])
			)
		: {};

const allChecksPassed = (value) => {
	const checks = Object.values(value ?? {});
	return checks.length > 0 && checks.every((check) => check === true);
};

const assertProviderCleanup = (name, value) => {
	if (
		value?.failedCount !== 0 ||
		value?.remainingDisposableUsers !== 0 ||
		value?.attempted !== value?.verifiedDeleted
	) {
		throw new Error(`Staging proof ${name} did not clean up every fixture.`);
	}
};

const safeInteger = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

const optionalCheck = (value) => (typeof value === 'boolean' ? value : null);

const utc = (value) => {
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime())) throw new Error('Evidence timestamp is invalid.');
	return parsed.toISOString();
};
