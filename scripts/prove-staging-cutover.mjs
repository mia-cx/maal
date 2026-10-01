#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import authSlotConfig from '../playwright.auth-slots.config.ts';
import {
	STAGING_WRANGLER_CONFIG,
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
			await runJson('pnpm', ['test:proof:auth-slots:api'], providerEnvironment)
		);
		const authHosted = summarizeAuthEvidence(
			await runJson('pnpm', ['test:proof:auth-slots:hosted'], providerEnvironment)
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
			await runJson('pnpm', ['test:proof:billing'], providerEnvironment)
		);
		const runtime = summarizeBooleanProof(
			await runJson('pnpm', ['test:proof:staging:runtime'], providerEnvironment)
		);
		const freeUse = summarizeBooleanProof(
			await runJson('pnpm', ['test:proof:staging:free-use'], providerEnvironment)
		);
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
		assertPassingBooleanProof('freeUse', freeUse);
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
				freeUse
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

function runJson(executable, args, environment) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
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
				rejectPromise(new Error(`${args[0]} failed without publishing provider output.`));
				return;
			}
			try {
				resolvePromise(JSON.parse(stdout));
			} catch {
				rejectPromise(new Error(`${args[0]} returned invalid proof JSON.`));
			}
		});
	});
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
