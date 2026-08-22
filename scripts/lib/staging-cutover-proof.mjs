import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const STAGING_CONFIRMATION = 'create-and-remove-disposable-staging-fixtures';

const requiredLiveSettings = [
	'MAAL_STAGING_BASE_URL',
	'MAAL_STAGING_DEPLOYMENT_LABEL',
	'MAAL_STAGING_DATABASE_NAME',
	'MAAL_STAGING_WRANGLER_CONFIG',
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
	if (url.hostname === 'maal.mia.cx') {
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
	if (environment.MAAL_STAGING_DATABASE_NAME !== 'maal-v1-staging') {
		throw new Error('Staging proof only accepts MAAL_STAGING_DATABASE_NAME=maal-v1-staging.');
	}

	const baseUrl = validateStagingOrigin(environment.MAAL_STAGING_BASE_URL);
	if (!/^[-a-zA-Z0-9_.]{1,80}$/.test(environment.MAAL_STAGING_DEPLOYMENT_LABEL)) {
		throw new Error('MAAL_STAGING_DEPLOYMENT_LABEL must be a short non-secret label.');
	}

	const configPath = resolve(repositoryRoot, environment.MAAL_STAGING_WRANGLER_CONFIG);
	const configStats = await stat(configPath).catch(() => null);
	if (!configStats?.isFile()) {
		throw new Error('MAAL_STAGING_WRANGLER_CONFIG must name an existing ignored Wrangler file.');
	}
	await validateWranglerStagingConfig(configPath);
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

const validateWranglerStagingConfig = async (path) => {
	let configuration;
	try {
		configuration = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		throw new Error('MAAL_STAGING_WRANGLER_CONFIG must contain valid JSON-compatible JSONC.');
	}
	const staging = configuration?.env?.staging;
	if (configuration?.main !== 'src/worker.ts') {
		throw new Error('Wrangler main must be src/worker.ts.');
	}
	const compatibilityFlags = staging?.compatibility_flags ?? configuration?.compatibility_flags;
	if (!Array.isArray(compatibilityFlags) || !compatibilityFlags.includes('nodejs_compat')) {
		throw new Error('Wrangler staging requires the nodejs_compat compatibility flag.');
	}
	if (staging?.name !== 'maal-v1-staging') {
		throw new Error('Wrangler staging Worker name must be maal-v1-staging.');
	}
	if (staging.vars?.MAAL_PROOF_TELEMETRY !== 'staging-only') {
		throw new Error('Wrangler staging must enable staging-only proof telemetry.');
	}
	assertNoSecretVars(configuration);
	const databases = staging.d1_databases;
	const database =
		Array.isArray(databases) && databases.length === 1 && databases[0]?.binding === 'DB'
			? databases[0]
			: null;
	if (
		database?.database_name !== 'maal-v1-staging' ||
		database.migrations_dir !== 'drizzle' ||
		!validInfrastructureUuid(database.database_id)
	) {
		throw new Error(
			'Wrangler staging DB binding must name the provisioned maal-v1-staging D1 database.'
		);
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

const permittedFreeUseCalls = [
	{ method: 'GET', pattern: /^\/api\/auth-slots\/[^/]+\/$/, routeClass: 'auth' },
	{ method: 'POST', pattern: /^\/api\/auth-slots\/[^/]+\/refresh$/, routeClass: 'auth' },
	{
		method: 'GET',
		pattern: /^\/api\/auth-slots\/[^/]+\/households\/[^/]+$/,
		routeClass: 'admin'
	},
	{
		method: 'GET',
		pattern: /^\/api\/auth-slots\/[^/]+\/billing\/status$/,
		routeClass: 'billing'
	}
];

export const classifyPermittedFreeUseCall = (method, pathname) =>
	permittedFreeUseCalls.find(
		(candidate) => candidate.method === method.toUpperCase() && candidate.pattern.test(pathname)
	)?.routeClass ?? null;

export const fixtureCleanupComplete = (cleanup, failures = []) =>
	Array.isArray(failures) &&
	failures.length === 0 &&
	cleanup !== null &&
	typeof cleanup === 'object' &&
	Object.values(cleanup).length > 0 &&
	Object.values(cleanup).every((value) => value === true || value === 0);

export const mergeFixtureIds = (current, discovered) =>
	[...new Set([...(current ?? []), ...(discovered ?? [])])].sort();

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
