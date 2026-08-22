import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

describe('local release automation', () => {
	test('runs the D1 migration chain after the application validation gate', async () => {
		const workflow = await readFile(
			new URL('../../.github/workflows/ci.yml', import.meta.url),
			'utf8'
		);
		const validation = workflow.indexOf('- run: pnpm validate');
		const migrations = workflow.indexOf('- run: pnpm test:d1-schema');

		expect(validation).toBeGreaterThan(-1);
		expect(migrations).toBeGreaterThan(validation);
	});

	test('keeps the cookie security override in pnpm workspace configuration and lockfile', async () => {
		const [workspace, lockfile, packageSource] = await Promise.all([
			readFile('pnpm-workspace.yaml', 'utf8'),
			readFile('pnpm-lock.yaml', 'utf8'),
			readFile('package.json', 'utf8')
		]);
		const packageJson = JSON.parse(packageSource) as { pnpm?: unknown };

		expect(workspace).toMatch(/(?:^|\n)overrides:\n  'cookie@<0\.7\.0': 0\.7\.2(?:\n|$)/);
		expect(lockfile).toMatch(/(?:^|\n)overrides:\n  cookie@<0\.7\.0: 0\.7\.2(?:\n|$)/);
		expect(packageJson.pnpm).toBeUndefined();
	});
});
