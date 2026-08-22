import { open, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const [databaseName, schemaPath, outputPath] = process.argv.slice(2);
const allowedDatabaseNames = new Set(['maal-staging', 'maal-prod']);
if (
	!databaseName ||
	!allowedDatabaseNames.has(databaseName) ||
	!schemaPath ||
	!outputPath ||
	!isAbsolute(schemaPath) ||
	!isAbsolute(outputPath)
) {
	throw new TypeError(
		'Usage: node scripts/generate-d1-reset-sql.mjs <maal-staging|maal-prod> /absolute/private/<database>-before-rewrite.sql /absolute/private/<database>-reset.sql'
	);
}
if (
	basename(schemaPath) !== `${databaseName}-before-rewrite.sql` ||
	basename(outputPath) !== `${databaseName}-reset.sql`
) {
	throw new TypeError(
		'The schema export and reset filenames must match the exact D1 database name.'
	);
}
const repository = await realpath(resolve('.'));
const resolvedSchemaPath = await realpath(schemaPath);
const resolvedOutputDirectory = await realpath(dirname(outputPath));
const isInsideRepository = (path) => path === repository || path.startsWith(`${repository}/`);
if (
	isInsideRepository(resolvedSchemaPath) ||
	isInsideRepository(resolve(resolvedOutputDirectory, basename(outputPath)))
) {
	throw new TypeError('D1 schema exports and reset SQL must stay outside the repository.');
}

const source = await readFile(schemaPath, 'utf8');
const names = (kind) => {
	const pattern = new RegExp(
		`CREATE\\s+${kind}(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(?:"([^"]+)"|\x60([^\x60]+)\x60|\\[([^\\]]+)\\]|([A-Za-z_][A-Za-z0-9_]*))`,
		'gi'
	);
	return [...source.matchAll(pattern)]
		.map((match) => match[1] ?? match[2] ?? match[3] ?? match[4])
		.filter((name) => {
			const normalized = name.toLowerCase();
			return !normalized.startsWith('sqlite_') && !normalized.startsWith('_cf_');
		});
};
const triggers = [...new Set(names('TRIGGER'))].sort();
const views = [...new Set(names('VIEW'))].sort();
const tables = [...new Set([...names('TABLE'), 'd1_migrations'])].sort().reverse();
if (tables.length === 1)
	throw new TypeError('The schema export did not contain an application table.');
const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
const statements = [
	`-- Generated reset for the operator-reviewed ${databaseName} D1 schema export.`,
	'PRAGMA defer_foreign_keys = ON;',
	...triggers.map((name) => `DROP TRIGGER IF EXISTS ${identifier(name)};`),
	...views.map((name) => `DROP VIEW IF EXISTS ${identifier(name)};`),
	...tables.map((name) => `DROP TABLE IF EXISTS ${identifier(name)};`),
	'PRAGMA defer_foreign_keys = OFF;'
];
const handle = await open(outputPath, 'wx', 0o600);
try {
	await handle.writeFile(`${statements.join('\n')}\n`, 'utf8');
} finally {
	await handle.close();
}
