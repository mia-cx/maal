import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const STAGING_CONFIRMATION = 'create-and-remove-disposable-staging-fixtures';

const requiredLiveSettings = [
	'MAAL_STAGING_BASE_URL',
	'MAAL_STAGING_DEPLOYMENT_LABEL',
	'MAAL_STAGING_DATABASE_NAME',
	'MAAL_STAGING_WRANGLER_CONFIG',
	'MAAL_STAGING_FIXTURE_FILE',
	'WORKOS_API_KEY',
	'WORKOS_CLIENT_ID',
	'WORKOS_COOKIE_PASSWORD',
	'STRIPE_SECRET_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'STRIPE_PRODUCT_ID',
	'BILLING_MAINTENANCE_SECRET'
];

export const contractProofFiles = [
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
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
		throw new Error('MAAL_STAGING_BASE_URL must be a clean HTTPS staging origin.');
	}
	if (url.hostname === 'maal.mia.cx') {
		throw new Error('Staging proof refuses the production Maal hostname.');
	}
	return url.origin;
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
	if (!isAbsolute(environment.MAAL_STAGING_FIXTURE_FILE)) {
		throw new Error('MAAL_STAGING_FIXTURE_FILE must be an absolute private temporary path.');
	}
	const fixturePath = resolve(environment.MAAL_STAGING_FIXTURE_FILE);
	const fixtureRelative = relative(repositoryRoot, fixturePath);
	if (!fixtureRelative.startsWith('..') || fixtureRelative === '') {
		throw new Error('MAAL_STAGING_FIXTURE_FILE must stay outside the repository.');
	}
	return {
		baseUrl,
		deploymentLabel: environment.MAAL_STAGING_DEPLOYMENT_LABEL,
		databaseName: environment.MAAL_STAGING_DATABASE_NAME,
		wranglerConfigPath: configPath,
		fixturePath,
		providerModes: { workos: 'staging', stripe: 'test', cloudflare: 'staging' }
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
