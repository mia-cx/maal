import { open, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const [schemaPath, outputPath] = process.argv.slice(2);
if (!schemaPath || !outputPath || !isAbsolute(schemaPath) || !isAbsolute(outputPath)) {
	throw new TypeError(
		'Usage: node scripts/generate-d1-reset-sql.mjs /absolute/private/schema.sql /absolute/private/reset.sql'
	);
}
const repository = resolve('.');
if (
	resolve(schemaPath).startsWith(`${repository}/`) ||
	resolve(outputPath).startsWith(`${repository}/`)
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
		.filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_cf_'));
};
const views = [...new Set(names('VIEW'))].sort();
const tables = [...new Set([...names('TABLE'), 'd1_migrations'])].sort().reverse();
if (tables.length === 1)
	throw new TypeError('The schema export did not contain an application table.');
const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
const statements = [
	'-- Generated reset for an operator-reviewed D1 schema export.',
	'PRAGMA defer_foreign_keys = ON;',
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
