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
});
