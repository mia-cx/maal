import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isReleaseMerge, releaseValidated } from './release-merge.mjs';

const sha = 'a'.repeat(40);
const repository = 'mia-cx/maal';
const release = {
	merged_at: '2026-10-29T00:00:00Z',
	merge_commit_sha: sha,
	base: { ref: 'main', repo: { full_name: repository } },
	head: { ref: 'changeset-release/main', repo: { full_name: repository } }
};

test('only a merged release pull request from this repository deploys its own merge commit to production', () => {
	const cases = [
		['the merged release pull request', release, true],
		['an unmerged release pull request', { ...release, merged_at: null }, false],
		['a different merge commit', { ...release, merge_commit_sha: 'b'.repeat(40) }, false],
		[
			'a different base repository',
			{ ...release, base: { ref: 'main', repo: { full_name: 'fork/mia-cx' } } },
			false
		],
		[
			'a release branch from a fork',
			{ ...release, head: { ...release.head, repo: { full_name: 'fork/mia-cx' } } },
			false
		],
		[
			'an ordinary feature branch',
			{ ...release, head: { ...release.head, ref: 'feat/anything' } },
			false
		],
		['a release merged into another branch', { ...release, base: { ref: 'staging' } }, false]
	];
	for (const [name, pr, expected] of cases)
		assert.equal(isReleaseMerge([pr], { sha, repository }), expected, name);
});

test('validation fetches a squash-merged PR head and fails closed on different trees or lookup errors', (t) => {
	const temporary = mkdtempSync(join(tmpdir(), 'maal-release-validation-'));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	const origin = join(temporary, 'origin.git');
	const source = join(temporary, 'source');
	const checkout = join(temporary, 'checkout');
	const bin = join(temporary, 'bin');
	const git = (cwd, ...args) =>
		execFileSync('git', ['-C', cwd, ...args], {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe']
		}).trim();
	mkdirSync(source);
	mkdirSync(bin);
	git(temporary, 'init', '--bare', '--initial-branch=main', origin);
	git(source, 'init', '--initial-branch=main');
	git(source, 'config', 'user.name', 'Release test');
	git(source, 'config', 'user.email', 'release@example.test');
	const commit = (text) => {
		writeFileSync(join(source, 'site.txt'), text);
		git(source, 'add', '.');
		git(source, 'commit', '-m', text);
		return git(source, 'rev-parse', 'HEAD');
	};
	commit('base');
	git(source, 'switch', '-c', 'changeset-release/main');
	const head = commit('release');
	git(source, 'switch', 'main');
	git(source, 'merge', '--squash', 'changeset-release/main');
	git(source, 'commit', '-m', 'squash release');
	const merge = git(source, 'rev-parse', 'HEAD');
	const differentTree = commit('changed after validation');
	git(source, 'remote', 'add', 'origin', origin);
	git(source, 'push', 'origin', 'main', `${head}:refs/pull/143/head`);
	// --no-local prevents local clone optimizations from copying the unreachable PR head.
	git(temporary, 'clone', '--no-local', '--single-branch', origin, checkout);
	assert.throws(() => git(checkout, 'cat-file', '-e', head));
	writeFileSync(
		join(bin, 'gh'),
		`#!/usr/bin/env node
if (process.env.TEST_API_ERROR) process.exit(1);
const expected = 'repos/${repository}/actions/workflows/release-validation.yml/runs?event=pull_request&head_sha=${head}&status=success&per_page=100';
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['api', expected, '--paginate', '--slurp'])) process.exit(2);
process.stdout.write(process.env.TEST_RUNS);
`,
		{ mode: 0o755 }
	);
	const run = {
		event: 'pull_request',
		path: '.github/workflows/release-validation.yml',
		head_sha: head,
		head_branch: release.head.ref,
		head_repository: { full_name: repository },
		pull_requests: [],
		status: 'completed',
		conclusion: 'success'
	};
	const cli = (overrides = {}, prOverrides = {}, target = merge) =>
		spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL('./release-merge.mjs', import.meta.url)),
				target,
				repository,
				'validated'
			],
			{
				cwd: checkout,
				encoding: 'utf8',
				input: JSON.stringify([
					[
						{
							...release,
							number: 143,
							merge_commit_sha: target,
							head: { ...release.head, sha: head },
							...prOverrides
						}
					]
				]),
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					GITHUB_EVENT_NAME: 'push',
					GITHUB_REF: 'refs/heads/main',
					GITHUB_SHA: target,
					GITHUB_OUTPUT: join(temporary, 'output'),
					TEST_RUNS: JSON.stringify([{ workflow_runs: [] }, { workflow_runs: [run] }]),
					...overrides
				}
			}
		);
	const success = cli();
	assert.equal(success.status, 0, success.stderr);
	assert.equal(success.stdout, 'validated=true\n');
	assert.equal(readFileSync(join(temporary, 'output'), 'utf8'), 'validated=true\n');
	assert.equal(
		git(checkout, 'rev-parse', `${merge}^{tree}`),
		git(checkout, 'rev-parse', `${head}^{tree}`)
	);
	for (const [name, env, pr, target] of [
		['tree mismatch', {}, {}, differentTree],
		['manual retry', { GITHUB_EVENT_NAME: 'workflow_dispatch' }],
		['push on another branch', { GITHUB_REF: 'refs/heads/staging' }],
		['a different pushed commit', { GITHUB_SHA: differentTree }],
		['non-release push', {}, { head: { ...release.head, ref: 'feature', sha: head } }],
		['no validation runs', { TEST_RUNS: JSON.stringify([{ workflow_runs: [] }]) }],
		['API failure', { TEST_API_ERROR: 'true' }],
		['invalid API response', { TEST_RUNS: '{}' }]
	]) {
		const result = cli(env, pr, target);
		assert.equal(result.status, 0, `${name}: ${result.stderr}`);
		assert.equal(result.stdout, 'validated=false\n', name);
		if (name.includes('API')) assert.match(result.stderr, /::warning::/);
	}
	git(origin, 'update-ref', '-d', 'refs/pull/143/head');
	const missingRef = cli();
	assert.equal(missingRef.status, 0);
	assert.equal(missingRef.stdout, 'validated=false\n');
	assert.match(missingRef.stderr, /::warning::/);
});

test('validation belongs to the exact release PR head even after GitHub clears its pull_requests list', () => {
	const pr = { ...release, head: { ...release.head, sha: 'b'.repeat(40) } };
	const run = {
		event: 'pull_request',
		path: '.github/workflows/release-validation.yml',
		head_sha: pr.head.sha,
		head_branch: pr.head.ref,
		head_repository: { full_name: repository },
		pull_requests: [],
		status: 'completed',
		conclusion: 'success'
	};
	const cases = [
		['merged PR with no pull_requests', {}, true],
		['workflow path with a ref', { path: `${run.path}@refs/heads/main` }, true],
		['wrong head branch', { head_branch: 'feature' }, false],
		['fork head repository', { head_repository: { full_name: 'fork/mia-cx' } }, false],
		['missing head repository', { head_repository: null }, false],
		['wrong workflow path', { path: '.github/workflows/deploy.yml' }, false],
		['wrong head SHA', { head_sha: 'c'.repeat(40) }, false],
		['push run', { event: 'push' }, false],
		['unfinished run', { status: 'in_progress' }, false],
		['failed run', { conclusion: 'failure' }, false],
		['skipped run', { conclusion: 'skipped' }, false]
	];
	for (const [name, overrides, expected] of cases)
		assert.equal(releaseValidated([{ ...run, ...overrides }], pr), expected, name);
	assert.equal(releaseValidated([], pr), false, 'no runs');
});

test('deploy skips only validated production checks and always builds and deploys its artifact', () => {
	const deploy = readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8');
	const validation = readFileSync(
		new URL('../workflows/release-validation.yml', import.meta.url),
		'utf8'
	);
	const workflow = readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8');
	const step = (yaml, name) => yaml.split(`      - name: ${name}\n`)[1].split('\n      - ')[0];
	const commands = (text) =>
		text
			.split(/\n/)
			.map((line) => line.trim().replace(/^run: /, ''))
			.filter((line) => line.startsWith('pnpm '));
	const checkCode = step(deploy, 'Check code');
	const browser = step(deploy, "Install the browser for the app's tests");
	const build = step(deploy, 'Build the deployment artifact');
	assert.deepEqual(commands(step(validation, 'Check code')), [
		...commands(checkCode),
		...commands(build)
	]);
	assert.equal(
		browser.match(/run: (.+)/)[1],
		step(validation, "Install the browser for the app's tests").match(/run: (.+)/)[1]
	);
	assert.match(validation, /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
	assert.match(validation, /github.head_ref == 'changeset-release\/main'/);
	for (const text of [browser, checkCode]) {
		const condition = text.match(/if: \$\{\{ (.+) \}\}/)[1];
		// These boolean/string expressions use the same operators in Actions and JavaScript.
		const shouldCheck = new Function('inputs', 'github', 'steps', `return ${condition}`);
		for (const [name, environment, event, ref, validated, target, expected] of [
			['validated release', 'production', 'push', 'main', sha, sha, false],
			['unvalidated release', 'production', 'push', 'main', '', sha, true],
			['queue selects another release', 'production', 'push', 'main', sha, 'b'.repeat(40), true],
			['manual retry', 'production', 'workflow_dispatch', 'main', sha, sha, true],
			['staging push', 'staging', 'push', 'main', sha, sha, true],
			['another branch', 'production', 'push', 'feature', sha, sha, true]
		]) {
			assert.equal(
				shouldCheck(
					{ environment, validated_sha: validated },
					{ event_name: event, ref: `refs/heads/${ref}` },
					{ target: { outputs: { sha: target } } }
				),
				expected,
				name
			);
		}
	}
	assert.doesNotMatch(build, /\bif:/);
	assert.deepEqual(commands(build), ['pnpm build']);
	assert.doesNotMatch(step(deploy, 'Deploy'), /\bif:/);
	assert.match(step(deploy, 'Deploy'), /wrangler deploy/);
	const production = workflow.split('\n  production:\n')[1].split('\n  tag:\n')[0];
	assert.match(production, /if: needs.release.outputs.release == 'true'/);
	assert.match(
		production,
		/validated_sha: \$\{\{ needs.release.outputs.validated == 'true' && needs.release.outputs.sha \|\| '' \}\}/
	);
	assert.match(workflow.split('\n  version:\n')[0], /actions: read/);
	assert.doesNotMatch(
		workflow.split('\n  staging:\n')[1].split('\n  production:\n')[0],
		/validated_sha/
	);
});
