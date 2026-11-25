import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, test } from 'vitest';

import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

// `wrangler d1 export --local --no-data` of the prototype chain at main@74a12ec3.
// 0000-0004 is the schema maal-staging holds today; 0000-0007 is the full prototype chain.
const prototypeExports = [
	'tests/fixtures/d1-reset/prototype-0000-0004.sql',
	'tests/fixtures/d1-reset/prototype-0000-0007.sql'
];

// Wrangler creates this table on the first `d1 migrations apply`.
const D1_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "d1_migrations"(
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT UNIQUE,
	applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

const instances: Miniflare[] = [];
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const createDatabase = async (): Promise<D1Database> => {
	const miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	instances.push(miniflare);
	return miniflare.getD1Database('DB');
};

/** Runs a multi-statement SQL file in one batch, like `wrangler d1 execute --file`. */
const executeFile = async (database: D1Database, sql: string): Promise<void> => {
	const statements = sql
		.split(/;\s*\n/)
		.map((statement) => statement.trim())
		.filter(Boolean);
	await database.batch(statements.map((statement) => database.prepare(statement)));
};

const exportSchema = async (database: D1Database): Promise<string> => {
	const { results } = await database
		.prepare(
			`SELECT sql FROM sqlite_schema
			 WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`
		)
		.all<{ sql: string }>();
	return results.map(({ sql }) => `${sql};`).join('\n');
};

const generateReset = async (schema: string): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), 'maal-d1-reset-rehearsal-'));
	directories.push(directory);
	const schemaPath = join(directory, 'maal-staging-before-rewrite.sql');
	const outputPath = join(directory, 'maal-staging-reset.sql');
	await writeFile(schemaPath, schema, 'utf8');
	const result = spawnSync(
		process.execPath,
		[resolve('scripts/generate-d1-reset-sql.mjs'), 'maal-staging', schemaPath, outputPath],
		{ cwd: resolve('.'), encoding: 'utf8' }
	);
	expect(result.status, result.stderr).toBe(0);
	return readFile(outputPath, 'utf8');
};

const applicationObjects = async (database: D1Database): Promise<unknown[]> =>
	(
		await database
			.prepare(
				`SELECT type, name FROM sqlite_schema
				 WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`
			)
			.all()
	).results;

const expectResetThenRewriteChain = async (database: D1Database, schema: string) => {
	await executeFile(database, await generateReset(schema));
	await expect(applicationObjects(database)).resolves.toEqual([]);

	await applyD1Migrations(database, await readD1MigrationFiles());
	await expect(
		database
			.prepare(
				'SELECT (SELECT COUNT(*) FROM units) AS units, (SELECT COUNT(*) FROM unit_aliases) AS unitAliases'
			)
			.first()
	).resolves.toEqual({ units: 40, unitAliases: 184 });
};

describe('rewrite-launch D1 reset execution', () => {
	test.each(prototypeExports)('empties the prototype schema in %s', async (path) => {
		const schema = await readFile(path, 'utf8');
		const database = await createDatabase();
		await executeFile(database, schema);
		await expect(applicationObjects(database)).resolves.not.toEqual([]);

		await expectResetThenRewriteChain(database, schema);
	});

	test('empties a migrated rewrite schema', async () => {
		const database = await createDatabase();
		await applyD1Migrations(database, await readD1MigrationFiles());
		await executeFile(database, D1_MIGRATIONS_TABLE);

		await expectResetThenRewriteChain(database, await exportSchema(database));
	});
});
