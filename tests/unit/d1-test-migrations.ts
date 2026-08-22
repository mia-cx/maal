import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface D1MigrationFile {
	readonly name: string;
	readonly source: string;
}

interface SchemaRow {
	readonly type: 'index' | 'table';
	readonly name: string;
	readonly tbl_name: string;
	readonly sql: string | null;
}

export const readD1MigrationFiles = async (
	directory = 'drizzle'
): Promise<readonly D1MigrationFile[]> => {
	const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
	return Promise.all(
		names.map(async (name) => ({ name, source: await readFile(join(directory, name), 'utf8') }))
	);
};

export const applyD1Migrations = async (
	database: D1Database,
	migrations: readonly D1MigrationFile[]
): Promise<void> => {
	for (const migration of migrations) {
		await applyD1Migration(database, migration);
	}
};

export const applyD1Migration = async (
	database: D1Database,
	migration: D1MigrationFile
): Promise<void> => {
	const statements = migration.source
		.split('--> statement-breakpoint')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((statement) => database.prepare(statement));
	await database.batch(statements);
};

const splitTopLevel = (value: string): readonly string[] => {
	const parts: string[] = [];
	let depth = 0;
	let quoted = false;
	let start = 0;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === "'" && value[index - 1] !== '\\') quoted = !quoted;
		if (quoted) continue;
		if (character === '(') depth += 1;
		if (character === ')') depth -= 1;
		if (character === ',' && depth === 0) {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(value.slice(start));
	return parts;
};

const normalizeSchemaSql = (sql: string | null): string | null => {
	const normalized =
		sql
			?.replaceAll('`', '')
			.replaceAll('"', '')
			.replaceAll('[', '')
			.replaceAll(']', '')
			.replace(/__new_/g, '')
			.replace(/__meal_check_ins_repaired/g, 'meal_check_ins')
			.replace(/\s+/g, ' ')
			.replace(/\s*([(),=<>+*])\s*/g, '$1')
			.trim() ?? null;
	if (!normalized?.startsWith('CREATE TABLE ')) return normalized;
	const bodyStart = normalized.indexOf('(');
	if (bodyStart === -1 || !normalized.endsWith(')')) return normalized;
	const body = normalized.slice(bodyStart + 1, -1);
	return `${normalized.slice(0, bodyStart + 1)}${splitTopLevel(body).toSorted().join(',')})`;
};

export const schemaFingerprint = async (
	database: D1Database
): Promise<{
	readonly objects: number;
	readonly tables: number;
	readonly indexes: number;
	readonly sha256: string;
}> => {
	const { results } = await database
		.prepare(
			`SELECT type, name, tbl_name, sql
			 FROM sqlite_schema
			 WHERE name NOT LIKE 'sqlite_%'
			   AND name NOT LIKE '_cf_%'
			   AND name <> 'd1_migrations'
			 ORDER BY type, name`
		)
		.all<SchemaRow>();
	const normalized = results.map((row) => ({
		type: row.type,
		name: row.name,
		tbl: row.tbl_name,
		sql: normalizeSchemaSql(row.sql)
	}));
	return {
		objects: normalized.length,
		tables: normalized.filter(({ type }) => type === 'table').length,
		indexes: normalized.filter(({ type }) => type === 'index').length,
		sha256: createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
	};
};
