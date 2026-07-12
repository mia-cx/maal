import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const confidenceRange = (column: AnySQLiteColumn): SQL =>
	sql`${column} IS NULL OR (${column} >= 0 AND ${column} <= 1)`;

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
