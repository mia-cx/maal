#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import authSlotConfig from '../playwright.auth-slots.config.ts';
import {
	FREE_USE_LOG_POLL,
	STAGING_WRANGLER_CONFIG,
	buildFreeUseLogQuery,
	evaluateFreeUseLogs,
	pollFreeUseLogs,
	telemetryQueryUrl,
	assertPassingAuthProof,
	assertPassingBillingProof,
	assertPassingBooleanProof,
	contractProofFiles,
	safeCommandEvidence,
	selectAuthSlotProjects,
	summarizeAuthEvidence,
	summarizeBillingEvidence,
	summarizeBooleanProof,
	validateLiveEnvironment,
	writeSanitizedEvidence
} from './lib/staging-cutover-proof.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [command = 'help', ...flags] = process.argv.slice(2);
const unknownFlags = flags.filter((flag) => !(command === 'live' && flag === '--skip-webkit'));
if (unknownFlags.length > 0) {
	throw new Error(`Unknown staging proof option for ${command}: ${unknownFlags.join(' ')}`);
}

switch (command) {
	case 'preflight': {
		const config = await validateLiveEnvironment(process.env, root);
		await assertCommittedWranglerConfig();
		process.stdout.write(
			`${JSON.stringify(
				{
					result: 'ready',
					deploymentLabel: config.deploymentLabel,
					databaseName: config.databaseName,
					originHost: new URL(config.baseUrl).host,
					providerModes: config.providerModes,
					secretsPrinted: false,
					infrastructureIdsPrinted: false
				},
				null,
				2
			)}\n`
		);
		break;
	}
	case 'contracts': {
		const startedAt = new Date().toISOString();
		await run('pnpm', ['exec', 'vitest', 'run', ...contractProofFiles]);
		await run('pnpm', ['test:d1-schema']);
		const finishedAt = new Date().toISOString();
		const output =
			process.env.MAAL_STAGING_EVIDENCE_FILE ??
			`/tmp/maal-staging-proof/contracts-${Date.now()}.json`;
		const path = await writeSanitizedEvidence(output, {
			schemaVersion: 1,
			result: 'passed',
			proof: safeCommandEvidence({
				name: 'local-staging-contract-matrix',
				result: 'passed',
				startedAt,
				finishedAt
			}),
			gates: {
				retainedAuthSlotContracts: 'passed',
				billingContracts: 'passed',
				paidSyncContracts: 'passed',
				statelessMcpContracts: 'passed',
				retentionAndPurgeContracts: 'passed',
				freeUseTransportContracts: 'passed',
				freeUseBrowserTrace: 'not-run-live-required'
			}
		});
		process.stdout.write(`Sanitized contract evidence: ${path}\n`);
		break;
	}
	case 'live': {
		const config = await validateLiveEnvironment(process.env, root);
		await assertCommittedWranglerConfig();
		const authSlotProjects = selectAuthSlotProjects(authSlotConfig.projects, {
			skipWebkit: flags.includes('--skip-webkit')
		});
		if (authSlotProjects.skipReason) {
			process.stderr.write(
				`Skipping auth-slot projects ${authSlotProjects.skippedProjects.join(', ')} (${authSlotProjects.skipReason}). The evidence records this.\n`
			);
		}
		const startedAt = new Date().toISOString();
		const freeUseRun = {
			deploymentLabel: config.deploymentLabel,
			proofRun: `free-use-${randomUUID()}`
		};
		const queryFreeUseLogs = await workersLogsQuery(freeUseRun);
		// Fails before any fixture exists when the Cloudflare credentials cannot read Workers Logs.
		evaluateFreeUseLogs(await queryFreeUseLogs(startedAt), {
			...freeUseRun,
			tracedRequestCount: 0
		});
		const output = config.evidencePath;
		const providerEnvironment = {
			...process.env,
			AUTH_SLOT_PROOF_BASE_URL: config.baseUrl,
			AUTH_SLOT_PROOF_REDIRECT_URI: config.authCallbackUrl,
			AUTH_SLOT_PROOF_DEPLOYMENT_LABEL: config.deploymentLabel,
			AUTH_SLOT_PROOF_GIT_COMMIT: await gitCommit()
		};
		await run('pnpm', ['proof:staging', 'contracts'], {
			env: {
				...providerEnvironment,
				MAAL_STAGING_EVIDENCE_FILE: `${output}.contracts.json`
			}
		});
		const authApi = summarizeAuthEvidence(
			await runJson('test:proof:auth-slots:api', providerEnvironment)
		);
		const authHosted = summarizeAuthEvidence(
			await runJson('test:proof:auth-slots:hosted', providerEnvironment)
		);
		await run(
			'pnpm',
			[
				'test:proof:auth-slots',
				...authSlotProjects.projects.map((project) => `--project=${project}`)
			],
			{ env: providerEnvironment }
		);
		const billing = summarizeBillingEvidence(
			await runJson('test:proof:billing', providerEnvironment)
		);
		const runtime = summarizeBooleanProof(
			await runJson('test:proof:staging:runtime', providerEnvironment)
		);
		const freeUseStartedAt = new Date().toISOString();
		const freeUse = summarizeBooleanProof(
			await runJson('test:proof:staging:free-use', {
				...providerEnvironment,
				MAAL_STAGING_PROOF_RUN: freeUseRun.proofRun
			})
		);
		assertPassingBooleanProof('freeUse', freeUse);
		const freeUseLogs = await pollFreeUseLogs({
			query: () => queryFreeUseLogs(freeUseStartedAt),
			pause: () => sleep(FREE_USE_LOG_POLL.pauseMs),
			run: { ...freeUseRun, tracedRequestCount: freeUse.observed.tracedRequestCount }
		});
		assertPassingAuthProof('authApi', authApi, [
			'bobSurvivedAliceRefresh',
			'bobSurvivedAliceRevocation'
		]);
		assertPassingAuthProof('authHosted', authHosted, [
			'aliceSurvivedBobLogin',
			'bobSurvivedAliceRevocation'
		]);
		assertPassingBillingProof('billing', billing);
		assertPassingBooleanProof('runtime', runtime);
		assertPassingBooleanProof('freeUseLogs', freeUseLogs);
		const path = await writeSanitizedEvidence(output, {
			schemaVersion: 1,
			result: 'passed',
			deploymentLabel: config.deploymentLabel,
			providerModes: config.providerModes,
			proof: safeCommandEvidence({
				name: 'staging-cutover-live',
				result: 'passed',
				startedAt,
				finishedAt: new Date().toISOString()
			}),
			gates: {
				retainedSlots: {
					directApi: authApi,
					hostedAuthKit: authHosted,
					deployedRoute: { result: 'passed', ...authSlotProjects }
				},
				billing,
				runtime,
				freeUse,
				freeUseLogs
			},
			nativeBrowserMatrix: { issue: 70, status: 'external-proof-required' },
			secretsIncluded: false,
			infrastructureIdsIncluded: false,
			personalDataIncluded: false
		});
		process.stdout.write(`Sanitized live evidence: ${path}\n`);
		break;
	}
	case 'help':
		process.stdout.write(
			[
				'Usage: pnpm proof:staging <preflight|contracts|live [--skip-webkit]>',
				'  preflight  validate staging-only operator inputs without printing them',
				'  contracts  run the local release-gate matrix and write sanitized evidence',
				'  live       run disposable provider and deployed-runtime proofs',
				'             --skip-webkit: this host cannot launch WebKit; skip and record those projects'
			].join('\n') + '\n'
		);
		break;
	default:
		throw new Error(`Unknown staging proof command: ${command}`);
}

async function assertCommittedWranglerConfig() {
	const result = await run('git', ['diff', '--quiet', 'HEAD', '--', STAGING_WRANGLER_CONFIG], {
		reject: false
	});
	if (result !== 0) {
		throw new Error(`${STAGING_WRANGLER_CONFIG} must match the candidate commit.`);
	}
}

function run(executable, args, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
			cwd: root,
			stdio: options.reject === false ? 'ignore' : 'inherit',
			env: options.env ?? process.env
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			const exitCode = code ?? 1;
			if (exitCode === 0 || options.reject === false) resolvePromise(exitCode);
			else rejectPromise(new Error(`${executable} failed with ${signal ?? `exit ${exitCode}`}.`));
		});
	});
}

/** Runs a package script whose stdout is one proof JSON document and parses it. */
function runJson(script, environment) {
	return new Promise((resolvePromise, rejectPromise) => {
		// --silent keeps pnpm's "> maal@… script" banner out of stdout, which must be pure JSON.
		const child = spawn('pnpm', ['--silent', script], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'ignore'],
			env: environment
		});
		let stdout = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
			if (stdout.length > 1_000_000) child.kill();
		});
		child.once('error', rejectPromise);
		child.once('exit', (code) => {
			if (code !== 0) {
				rejectPromise(new Error(`${script} failed without publishing provider output.`));
				return;
			}
			try {
				resolvePromise(JSON.parse(stdout));
			} catch {
				rejectPromise(new Error(`${script} returned invalid proof JSON.`));
			}
		});
	});
}

/**
 * Returns a read-only Workers Logs query for one free-use run. It authenticates with
 * `CLOUDFLARE_API_TOKEN` when set, otherwise with the operator's Wrangler login, read on every
 * query because Wrangler refreshes an OAuth token that expired during the proof matrix. Neither
 * the token nor the response body is printed.
 */
async function workersLogsQuery(run) {
	return async (startedAt) => {
		const token = process.env.CLOUDFLARE_API_TOKEN?.trim() || (await wranglerToken());
		const response = await fetch(telemetryQueryUrl(process.env.CLOUDFLARE_ACCOUNT_ID), {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(buildFreeUseLogQuery({ ...run, startedAt, now: Date.now() }))
		});
		if (response.status === 401 || response.status === 403) {
			throw new Error(
				`Workers Logs query returned HTTP ${response.status}. Run \`pnpm exec wrangler login\` again so the login carries Workers Observability access, or set CLOUDFLARE_API_TOKEN to a token with Workers Observability permission.`
			);
		}
		if (!response.ok) throw new Error(`Workers Logs query returned HTTP ${response.status}.`);
		return response.json();
	};
}

async function wranglerToken() {
	let output = '';
	await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'ignore']
		});
		child.stdout.on('data', (chunk) => (output += chunk.toString()));
		child.once('error', rejectPromise);
		child.once('exit', (code) =>
			code === 0
				? resolvePromise()
				: rejectPromise(new Error('Wrangler is not logged in; run `pnpm exec wrangler login`.'))
		);
	});
	let token;
	try {
		token = JSON.parse(output).token;
	} catch {
		token = undefined;
	}
	if (typeof token !== 'string' || !token) {
		throw new Error('Wrangler returned no bearer token; set CLOUDFLARE_API_TOKEN instead.');
	}
	return token;
}

async function gitCommit() {
	let output = '';
	await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'ignore']
		});
		child.stdout.on('data', (chunk) => (output += chunk.toString()));
		child.once('error', rejectPromise);
		child.once('exit', (code) =>
			code === 0 ? resolvePromise() : rejectPromise(new Error('Could not read the proof commit.'))
		);
	});
	return output.trim();
}
