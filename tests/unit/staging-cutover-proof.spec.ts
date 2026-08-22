import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
	readStagingProofD1Telemetry,
	stagingProofTelemetry,
	withStagingProofTelemetry
} from '../../src/lib/server/observability/staging-proof.ts';

import {
	STAGING_CONFIRMATION,
	assertPassingAuthProof,
	assertPassingBillingProof,
	assertPassingBooleanProof,
	classifyPermittedFreeUseCall,
	disposableStripeCustomers,
	disposableStripeSubscriptions,
	disposableWorkOSOrganizations,
	disposableWorkOSUsers,
	fixtureCleanupComplete,
	mergeFixtureIds,
	requireCleanupQuiescence,
	stableAuthCallback,
	summarizeAuthEvidence,
	summarizeBillingEvidence,
	summarizeBooleanProof,
	validateLiveEnvironment,
	writeSanitizedEvidence
} from '../../scripts/lib/staging-cutover-proof.mjs';

const liveEnvironment = (configPath: string) => ({
	MAAL_STAGING_PROOF_CONFIRM: STAGING_CONFIRMATION,
	MAAL_STAGING_BASE_URL: 'https://staging.maal.test',
	MAAL_STAGING_DEPLOYMENT_LABEL: 'staging-candidate-abc123',
	MAAL_STAGING_DATABASE_NAME: 'maal-v1-staging',
	MAAL_STAGING_WRANGLER_CONFIG: configPath,
	MAAL_STAGING_FIXTURE_FILE: join(tmpdir(), 'maal-proof-private-fixtures.json'),
	MAAL_STAGING_EVIDENCE_FILE: join(tmpdir(), 'maal-proof-private-evidence.json'),
	WORKOS_API_KEY: 'sk_test_workos_secret',
	WORKOS_CLIENT_ID: 'client_staging',
	WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
	STRIPE_SECRET_KEY: 'sk_test_stripe_secret',
	STRIPE_WEBHOOK_SECRET: 'whsec_staging_secret',
	STRIPE_PRODUCT_ID: 'prod_private',
	BILLING_MAINTENANCE_SECRET: 'private-maintenance-secret'
});

const stagingWrangler = {
	main: 'src/worker.ts',
	compatibility_flags: ['nodejs_compat'],
	assets: { binding: 'ASSETS', directory: '.svelte-kit/cloudflare' },
	observability: {
		enabled: true,
		logs: { head_sampling_rate: 1 },
		traces: { enabled: true, head_sampling_rate: 0.01 }
	},
	env: {
		staging: {
			name: 'maal-v1-staging',
			vars: { MAAL_PROOF_TELEMETRY: 'staging-only' },
			triggers: { crons: ['17 3 * * *'] },
			ratelimits: [
				{
					name: 'RECIPE_URL_RATE_LIMIT',
					namespace_id: '1002',
					simple: { limit: 10, period: 60 }
				}
			],
			d1_databases: [
				{
					binding: 'DB',
					database_name: 'maal-v1-staging',
					database_id: '123e4567-e89b-42d3-a456-426614174000',
					migrations_dir: 'drizzle'
				}
			]
		}
	}
};

describe('staging cutover proof safety', () => {
	test('fails with every missing live operator input and refuses production providers', async () => {
		await expect(validateLiveEnvironment({}, '/tmp')).rejects.toThrow(
			'MAAL_STAGING_PROOF_CONFIRM=create-and-remove-disposable-staging-fixtures'
		);
		const directory = await mkdtemp(join(tmpdir(), 'maal-staging-proof-'));
		const configPath = join(directory, 'wrangler.jsonc');
		await writeFile(configPath, JSON.stringify(stagingWrangler));
		await expect(
			validateLiveEnvironment(
				{ ...liveEnvironment(configPath), STRIPE_SECRET_KEY: 'sk_live_forbidden' },
				directory
			)
		).rejects.toThrow('not a test-mode sk_test_ key');
		await expect(
			validateLiveEnvironment(
				{ ...liveEnvironment(configPath), MAAL_STAGING_BASE_URL: 'https://maal.mia.cx' },
				directory
			)
		).rejects.toThrow('refuses the production Maal hostname');
	});

	test('returns only safe deployment facts from a complete staging environment', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'maal-staging-proof-'));
		const configPath = join(directory, 'wrangler.jsonc');
		await writeFile(configPath, JSON.stringify(stagingWrangler));
		await expect(validateLiveEnvironment(liveEnvironment(configPath), directory)).resolves.toEqual({
			baseUrl: 'https://staging.maal.test',
			authCallbackUrl: 'https://staging.maal.test/api/auth/callback',
			deploymentLabel: 'staging-candidate-abc123',
			databaseName: 'maal-v1-staging',
			wranglerConfigPath: configPath,
			fixturePath: join(tmpdir(), 'maal-proof-private-fixtures.json'),
			evidencePath: join(tmpdir(), 'maal-proof-private-evidence.json'),
			providerModes: { workos: 'staging', stripe: 'test', cloudflare: 'staging' }
		});
	});

	test('rejects unsafe origins and malformed staging Wrangler contracts', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'maal-staging-proof-'));
		const configPath = join(directory, 'wrangler.jsonc');
		await writeFile(configPath, JSON.stringify(stagingWrangler));
		await expect(
			validateLiveEnvironment(
				{ ...liveEnvironment(configPath), MAAL_STAGING_BASE_URL: 'https://staging.maal.test/app' },
				directory
			)
		).rejects.toThrow('clean HTTPS staging origin');
		expect(stableAuthCallback('https://staging.maal.test')).toBe(
			'https://staging.maal.test/api/auth/callback'
		);
		await expect(
			validateLiveEnvironment(
				{
					...liveEnvironment(configPath),
					MAAL_STAGING_EVIDENCE_FILE: join(directory, 'evidence.json')
				},
				directory
			)
		).rejects.toThrow('must stay outside the repository');

		for (const invalid of [
			{ ...stagingWrangler, main: 'src/wrong.ts' },
			{ ...stagingWrangler, compatibility_flags: [] },
			{ ...stagingWrangler, env: { staging: { ...stagingWrangler.env.staging, name: 'wrong' } } },
			{
				...stagingWrangler,
				env: { staging: { ...stagingWrangler.env.staging, vars: {} } }
			},
			{
				...stagingWrangler,
				env: {
					staging: {
						...stagingWrangler.env.staging,
						vars: { ...stagingWrangler.env.staging.vars, PUBLIC_VALUE: 'sk_test_private' }
					}
				}
			},
			{ ...stagingWrangler, vars: { SAFE_LOOKING_NAME: 'whsec_private' } },
			{
				...stagingWrangler,
				env: { staging: { ...stagingWrangler.env.staging, ratelimits: [] } }
			},
			{
				...stagingWrangler,
				env: {
					staging: {
						...stagingWrangler.env.staging,
						d1_databases: [
							{
								...stagingWrangler.env.staging.d1_databases[0],
								database_id: '00000000-0000-0000-0000-000000000000'
							}
						]
					}
				}
			},
			{
				...stagingWrangler,
				env: { staging: { ...stagingWrangler.env.staging, triggers: { crons: ['* * * * *'] } } }
			},
			{ ...stagingWrangler, assets: { binding: 'WRONG', directory: 'public' } },
			{ ...stagingWrangler, observability: { enabled: false } }
		]) {
			await writeFile(configPath, JSON.stringify(invalid));
			await expect(
				validateLiveEnvironment(liveEnvironment(configPath), directory)
			).rejects.toThrow();
		}
	});

	test('allowlists only explicit free-use auth, billing, and admin calls', () => {
		expect(classifyPermittedFreeUseCall('GET', '/api/auth-slots/slot/')).toBe('auth');
		expect(classifyPermittedFreeUseCall('POST', '/api/auth-slots/slot/refresh')).toBe('auth');
		expect(classifyPermittedFreeUseCall('GET', '/api/auth-slots/slot/billing/status')).toBe(
			'billing'
		);
		expect(classifyPermittedFreeUseCall('GET', '/api/auth-slots/slot/households/hh')).toBe('admin');
		expect(classifyPermittedFreeUseCall('POST', '/api/auth-slots/slot/sync/pull')).toBeNull();
		expect(classifyPermittedFreeUseCall('POST', '/mcp')).toBeNull();
		expect(classifyPermittedFreeUseCall('POST', '/api/billing/webhook')).toBeNull();
	});

	test('keeps the private cleanup ledger until every zero-remnant fact passes', () => {
		const complete = {
			workosUserDeleted: true,
			workosOrganizationDeleted: true,
			stripeObjectsDeleted: true,
			d1RowsRemaining: 0
		};
		expect(fixtureCleanupComplete(complete)).toBe(true);
		expect(fixtureCleanupComplete({ ...complete, d1RowsRemaining: null })).toBe(false);
		expect(fixtureCleanupComplete({ ...complete, stripeObjectsDeleted: false })).toBe(false);
		expect(fixtureCleanupComplete(complete, ['d1'])).toBe(false);
	});

	test('recovers fixture IDs after lost WorkOS and Stripe create responses', () => {
		const marker = {
			nonce: 'nonce-proof',
			email: 'maal-cutover+nonce-proof@example.test',
			organizationName: 'Disposable Maal proof nonce-proof'
		};
		const users = disposableWorkOSUsers(
			[
				{
					id: 'user_recovered',
					email: marker.email,
					metadata: { proof: 'staging-cutover', nonce: marker.nonce }
				},
				{
					id: 'user_other',
					email: marker.email,
					metadata: { proof: 'different', nonce: marker.nonce }
				}
			],
			marker
		);
		const organizations = disposableWorkOSOrganizations(
			[
				{ id: 'org_recovered', name: marker.organizationName },
				{ id: 'org_other', name: 'Unrelated household' }
			],
			marker
		);
		const customers = disposableStripeCustomers(
			[
				{
					id: 'cus_recovered',
					email: marker.email,
					metadata: { householdId: 'org_recovered', workosUserId: 'user_recovered' }
				},
				{
					id: 'cus_other',
					email: marker.email,
					metadata: { householdId: 'org_other', workosUserId: 'user_recovered' }
				}
			],
			{
				email: marker.email,
				householdIds: organizations.map((item: { id: string }) => item.id),
				userIds: users.map((item: { id: string }) => item.id)
			}
		);
		const subscriptions = disposableStripeSubscriptions(
			[
				{
					id: 'sub_recovered',
					metadata: { householdId: 'org_recovered', workosUserId: 'user_recovered' }
				},
				{
					id: 'sub_other',
					metadata: { householdId: 'org_other', workosUserId: 'user_recovered' }
				}
			],
			{
				householdIds: organizations.map((item: { id: string }) => item.id),
				userIds: users.map((item: { id: string }) => item.id),
				subscriptionIds: []
			}
		);
		expect(
			mergeFixtureIds(
				[],
				users.map((item: { id: string }) => item.id)
			)
		).toEqual(['user_recovered']);
		expect(organizations.map((item: { id: string }) => item.id)).toEqual(['org_recovered']);
		expect(customers.map((item: { id: string }) => item.id)).toEqual(['cus_recovered']);
		expect(subscriptions.map((item: { id: string }) => item.id)).toEqual(['sub_recovered']);
	});

	test('waits for two stable cleanup observations after a delayed Stripe event appears', async () => {
		const fingerprints = ['evt_initial', 'evt_delayed', 'evt_delayed'];
		const attempts: number[] = [];
		await expect(
			requireCleanupQuiescence({
				cycle: async (attempt: number) => {
					attempts.push(attempt);
					return { complete: true, fingerprint: fingerprints[attempt] };
				},
				pause: async () => undefined,
				maxAttempts: 4
			})
		).resolves.toEqual({ complete: true, fingerprint: 'evt_delayed' });
		expect(attempts).toEqual([0, 1, 2]);
	});

	test('emits staging-only per-request D1-open telemetry without buffering the response', async () => {
		const prepare = () => 'statement';
		const environment = {
			DB: { prepare },
			MAAL_PROOF_TELEMETRY: 'staging-only'
		} as unknown as Env & { MAAL_PROOF_TELEMETRY: string };
		const telemetry = stagingProofTelemetry(
			new Request('https://staging.maal.test/api/auth-slots/slot/', {
				headers: { 'x-maal-proof-trace': 'candidate-abc' }
			}),
			environment
		);
		expect(telemetry?.evidence.d1Opened).toBe(false);
		expect(telemetry?.environment.DB.prepare('SELECT 1')).toBe('statement');
		expect(telemetry?.evidence.d1Opened).toBe(true);
		const response = withStagingProofTelemetry(new Response('streamed'), telemetry!.evidence);
		expect(readStagingProofD1Telemetry(response.headers)).toBe(true);
		expect(await response.text()).toBe('streamed');
		expect(
			stagingProofTelemetry(
				new Request('https://staging.maal.test/api/test', {
					headers: { 'x-maal-proof-trace': 'candidate-abc' }
				}),
				{ ...environment, MAAL_PROOF_TELEMETRY: undefined }
			)
		).toBeNull();
	});

	test('allowlists provider evidence and writes a new private file', async () => {
		const auth = summarizeAuthEvidence({
			result: 'passed',
			aliceUserId: 'user_private',
			aliceSessionId: 'session_private',
			sealedSession: 'cookie_private',
			aliceCookieBytes: 2200,
			bobCookieBytes: 2210,
			bobSurvivedAliceRefresh: true,
			bobSurvivedAliceRevocation: true,
			cleanup: { attempted: 2, verifiedDeleted: 2, remainingDisposableUsers: 0 }
		});
		const billing = summarizeBillingEvidence({
			result: 'passed',
			mode: { stripe: 'test', workos: 'staging' },
			fixtures: { customer: 'cus_private' },
			checks: { trialCreated: true, refundCreated: true },
			cleanup: { attempted: 10, failed: ['secret provider error'] }
		});
		const runtime = summarizeBooleanProof({
			result: 'passed',
			checks: { paidSyncConverged: true },
			cleanup: { d1RowsRemaining: 0, workosUserDeleted: true, rawId: 'org_private' },
			observed: { unpermittedRemoteCallCount: 0, rawUrl: 'https://private.example' },
			secret: 'mk_private'
		});
		const directory = await mkdtemp(join(tmpdir(), 'maal-staging-proof-'));
		const evidenceDirectory = join(directory, 'private');
		await mkdir(evidenceDirectory, { mode: 0o700 });
		const path = join(evidenceDirectory, 'evidence.json');
		await writeSanitizedEvidence(path, { auth, billing, runtime });
		const encoded = await readFile(path, 'utf8');
		expect(encoded).not.toMatch(
			/user_private|session_private|cookie_private|cus_private|provider error/
		);
		expect(JSON.parse(encoded)).toEqual({
			auth: {
				result: 'passed',
				aliceCookieBytes: 2200,
				bobCookieBytes: 2210,
				aliceSurvivedBobLogin: null,
				bobSurvivedAliceRefresh: true,
				bobSurvivedAliceRevocation: true,
				cleanup: {
					attempted: 2,
					verifiedDeleted: 2,
					remainingDisposableUsers: 0,
					failedCount: 0,
					verifiedAtUtc: null
				}
			},
			billing: {
				result: 'passed',
				mode: { stripe: 'test', workos: 'staging' },
				checks: { trialCreated: true, refundCreated: true },
				cleanup: {
					attempted: 10,
					verifiedDeleted: null,
					remainingDisposableUsers: null,
					failedCount: 1,
					verifiedAtUtc: null
				}
			},
			runtime: {
				result: 'passed',
				checks: { paidSyncConverged: true },
				cleanup: { d1RowsRemaining: 0, workosUserDeleted: true },
				observed: { unpermittedRemoteCallCount: 0 }
			}
		});
		await expect(writeSanitizedEvidence(path, { result: 'overwrite' })).rejects.toThrow();
	});

	test('rejects passed labels when checks or cleanup are incomplete', () => {
		const cleanProvider = {
			failedCount: 0,
			attempted: 2,
			verifiedDeleted: 2,
			remainingDisposableUsers: 0
		};
		expect(() =>
			assertPassingAuthProof('auth', { result: 'passed', retained: true, cleanup: cleanProvider }, [
				'retained'
			])
		).not.toThrow();
		expect(() =>
			assertPassingAuthProof(
				'auth',
				{ result: 'passed', retained: false, cleanup: cleanProvider },
				['retained']
			)
		).toThrow('did not prove retained');
		expect(() =>
			assertPassingBillingProof('billing', {
				result: 'passed',
				checks: { lifecycle: true },
				cleanup: { failedCount: 1 }
			})
		).toThrow('did not clean up');
		expect(() =>
			assertPassingBooleanProof('runtime', {
				result: 'passed',
				checks: { converged: true },
				cleanup: { d1RowsRemaining: 1 }
			})
		).toThrow('did not clean up');
	});
});
