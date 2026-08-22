#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	contractProofFiles,
	safeCommandEvidence,
	validateLiveEnvironment,
	writeSanitizedEvidence
} from './lib/staging-cutover-proof.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [command = 'help'] = process.argv.slice(2);

switch (command) {
	case 'preflight': {
		const config = await validateLiveEnvironment(process.env, root);
		await assertIgnored(config.wranglerConfigPath);
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
			gates: [
				'retained-auth-slots',
				'billing-lifecycle-and-disorder',
				'paid-sync-convergence-and-lapse',
				'mcp-scopes-and-revocation',
				'sync-retention-and-household-purge',
				'free-use-zero-content-transport'
			]
		});
		process.stdout.write(`Sanitized contract evidence: ${path}\n`);
		break;
	}
	case 'live':
		throw new Error('Live staging composition is not implemented yet. Run preflight first.');
	case 'help':
		process.stdout.write(
			[
				'Usage: pnpm proof:staging <preflight|contracts|live>',
				'  preflight  validate staging-only operator inputs without printing them',
				'  contracts  run the local release-gate matrix and write sanitized evidence',
				'  live       run disposable provider and deployed-runtime proofs'
			].join('\n') + '\n'
		);
		break;
	default:
		throw new Error(`Unknown staging proof command: ${command}`);
}

async function assertIgnored(path) {
	const result = await run('git', ['check-ignore', '--quiet', path], { reject: false });
	if (result !== 0) {
		throw new Error('MAAL_STAGING_WRANGLER_CONFIG must be ignored by Git.');
	}
}

function run(executable, args, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(executable, args, {
			cwd: root,
			stdio: options.reject === false ? 'ignore' : 'inherit',
			env: process.env
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			const exitCode = code ?? 1;
			if (exitCode === 0 || options.reject === false) resolvePromise(exitCode);
			else rejectPromise(new Error(`${executable} failed with ${signal ?? `exit ${exitCode}`}.`));
		});
	});
}
