import { sql, type SQL } from 'drizzle-orm';
import { check, integer, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const createdAt = () =>
	text('created_at')
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const updatedAt = () =>
	text('updated_at')
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const mutableColumns = () => ({
	schemaVersion: integer('schema_version').notNull().default(1),
	revision: integer('revision').notNull().default(1),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
	deletedAt: text('deleted_at')
});

export const confidenceRange = (column: AnySQLiteColumn): SQL =>
	sql`${column} IS NULL OR (${column} >= 0 AND ${column} <= 1)`;

export const nullablePair = (left: AnySQLiteColumn, right: AnySQLiteColumn): SQL =>
	sql`((${left} IS NULL AND ${right} IS NULL) OR (${left} IS NOT NULL AND ${right} IS NOT NULL))`;

export const nonNegative = (column: AnySQLiteColumn): SQL => sql`${column} >= 0`;

export const nullablePositive = (column: AnySQLiteColumn): SQL =>
	sql`${column} IS NULL OR ${column} > 0`;

export const oneOf = (column: AnySQLiteColumn, values: readonly string[]): SQL => {
	// Values are closed, source-controlled enum constants. Parameters are prohibited in SQLite CHECK DDL.
	const literals = sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));
	return sql`${column} IN (${literals})`;
};

export const enumCheck = (name: string, column: AnySQLiteColumn, values: readonly string[]) =>
	check(name, oneOf(column, values));

export const nonEmptyMediaPayload = (columns: {
	url: AnySQLiteColumn;
	contentUrl: AnySQLiteColumn;
	embedUrl: AnySQLiteColumn;
	thumbnailUrl: AnySQLiteColumn;
}): SQL =>
	sql`${columns.url} IS NOT NULL OR ${columns.contentUrl} IS NOT NULL OR ${columns.embedUrl} IS NOT NULL OR ${columns.thumbnailUrl} IS NOT NULL`;

export const instructionEventPayload = (columns: {
	kind: AnySQLiteColumn;
	appliance: AnySQLiteColumn;
	value: AnySQLiteColumn;
	unitId: AnySQLiteColumn;
	baseValue: AnySQLiteColumn;
	baseUnitId: AnySQLiteColumn;
}): SQL => sql`(
	(${columns.kind} = 'appliance' AND ${columns.appliance} IS NOT NULL AND ${columns.value} IS NULL AND ${columns.unitId} IS NULL AND ${columns.baseValue} IS NULL AND ${columns.baseUnitId} IS NULL)
	OR (${columns.kind} IN ('temperature', 'duration') AND ${columns.appliance} IS NULL AND ${columns.value} IS NOT NULL AND ${columns.unitId} IS NOT NULL AND ${columns.baseValue} IS NOT NULL AND ${columns.baseUnitId} IS NOT NULL)
	OR (${columns.kind} = 'action' AND ${columns.appliance} IS NULL AND ${columns.value} IS NULL AND ${columns.unitId} IS NULL AND ${columns.baseValue} IS NULL AND ${columns.baseUnitId} IS NULL)
)`;
