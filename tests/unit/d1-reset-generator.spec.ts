import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

const directories: string[] = [];
const script = resolve('scripts/generate-d1-reset-sql.mjs');

const createDirectory = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), 'maal-d1-reset-'));
	directories.push(directory);
	return directory;
};

const runGenerator = (
	databaseName: string,
	schemaPath: string,
	outputPath: string
): ReturnType<typeof spawnSync> =>
	spawnSync(process.execPath, [script, databaseName, schemaPath, outputPath], {
		cwd: resolve('.'),
		encoding: 'utf8'
	});

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('rewrite-launch D1 reset generator', () => {
	test('binds the reviewed export and reset SQL to the exact staging database', async () => {
		const directory = await createDirectory();
		const schemaPath = join(directory, 'maal-staging-before-rewrite.sql');
		const outputPath = join(directory, 'maal-staging-reset.sql');
		await writeFile(
			schemaPath,
			`CREATE TABLE "users" ("id" text PRIMARY KEY);
CREATE TABLE "_cf_METADATA" ("key" text);
CREATE TABLE "sqlite_sequence" ("name" text);
CREATE VIEW "active_users" AS SELECT * FROM "users";
CREATE TRIGGER "users_audit" AFTER INSERT ON "users" BEGIN SELECT 1; END;
`,
			'utf8'
		);

		const result = runGenerator('maal-staging', schemaPath, outputPath);
		expect(result.status, String(result.stderr)).toBe(0);
		await expect(readFile(outputPath, 'utf8')).resolves.toBe(
			`-- Generated reset for the operator-reviewed maal-staging D1 schema export.
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER IF EXISTS "users_audit";
DROP VIEW IF EXISTS "active_users";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "d1_migrations";
PRAGMA defer_foreign_keys = OFF;
`
		);
		await expect(stat(outputPath)).resolves.toMatchObject({ mode: expect.any(Number) });
		expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
	});

	test('rejects a database or filename mismatch before writing reset SQL', async () => {
		const directory = await createDirectory();
		const stagingSchema = join(directory, 'maal-staging-before-rewrite.sql');
		const productionOutput = join(directory, 'maal-prod-reset.sql');
		await writeFile(stagingSchema, 'CREATE TABLE users (id text);', 'utf8');

		const mismatch = runGenerator('maal-staging', stagingSchema, productionOutput);
		expect(mismatch.status).not.toBe(0);
		expect(mismatch.stderr).toContain('filenames must match the exact D1 database name');
		await expect(stat(productionOutput)).rejects.toMatchObject({ code: 'ENOENT' });

		const unknown = runGenerator(
			'maal-production',
			stagingSchema,
			join(directory, 'maal-production-reset.sql')
		);
		expect(unknown.status).not.toBe(0);
		expect(unknown.stderr).toContain('<maal-staging|maal-prod>');
	});

	test('keeps staging and production runbook commands and confirmations environment-specific', async () => {
		const runbook = await readFile('docs/operations/staging-cutover.md', 'utf8');
		expect(runbook).toContain(
			'generate-d1-reset-sql.mjs maal-staging /absolute/private/path/maal-staging-before-rewrite.sql /absolute/private/path/maal-staging-reset.sql'
		);
		expect(runbook).toContain(
			'test "$MAAL_RESET_CONFIRMATION" = \'RESET maal-staging FOR REWRITE LAUNCH\''
		);
		expect(runbook).toContain(
			'generate-d1-reset-sql.mjs maal-prod /absolute/private/path/maal-prod-before-rewrite.sql /absolute/private/path/maal-prod-reset.sql'
		);
		expect(runbook).toContain(
			'test "$MAAL_RESET_CONFIRMATION" = \'RESET maal-prod FOR REWRITE LAUNCH\''
		);
	});
});
