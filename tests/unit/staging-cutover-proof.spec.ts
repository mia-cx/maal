import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
	STAGING_CONFIRMATION,
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
	WORKOS_API_KEY: 'sk_test_workos_secret',
	WORKOS_CLIENT_ID: 'client_staging',
	WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
	STRIPE_SECRET_KEY: 'sk_test_stripe_secret',
	STRIPE_WEBHOOK_SECRET: 'whsec_staging_secret',
	STRIPE_PRODUCT_ID: 'prod_private',
	BILLING_MAINTENANCE_SECRET: 'private-maintenance-secret'
});

describe('staging cutover proof safety', () => {
	test('fails with every missing live operator input and refuses production providers', async () => {
		await expect(validateLiveEnvironment({}, '/tmp')).rejects.toThrow(
			'MAAL_STAGING_PROOF_CONFIRM=create-and-remove-disposable-staging-fixtures'
		);
		const directory = await mkdtemp(join(tmpdir(), 'maal-staging-proof-'));
		const configPath = join(directory, 'wrangler.jsonc');
		await writeFile(configPath, '{}');
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
		await writeFile(configPath, '{}');
		await expect(validateLiveEnvironment(liveEnvironment(configPath), directory)).resolves.toEqual({
			baseUrl: 'https://staging.maal.test',
			deploymentLabel: 'staging-candidate-abc123',
			databaseName: 'maal-v1-staging',
			wranglerConfigPath: configPath,
			fixturePath: join(tmpdir(), 'maal-proof-private-fixtures.json'),
			providerModes: { workos: 'staging', stripe: 'test', cloudflare: 'staging' }
		});
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
			observed: { paidContentRequestCount: 0, rawUrl: 'https://private.example' },
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
				observed: { paidContentRequestCount: 0 }
			}
		});
		await expect(writeSanitizedEvidence(path, { result: 'overwrite' })).rejects.toThrow();
	});
});
