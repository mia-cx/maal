type DrizzleSqlQuery = {
	toSQL(): { sql: string; params: unknown[] };
};

type D1Value = string | number | boolean | null | ArrayBuffer | ArrayBufferView;

export const requireD1Database = (platform: App.Platform | undefined): D1Database => {
	if (!platform) throw new Error('D1 database binding is required.');
	return platform.env.DB;
};

const d1Value = (value: unknown): D1Value => {
	if (value === undefined) return null;
	if (value instanceof Date) return value.toISOString();
	return value as D1Value;
};

export const d1Statement = (database: D1Database, query: DrizzleSqlQuery): D1PreparedStatement => {
	const { sql, params } = query.toSQL();
	return database.prepare(sql).bind(...params.map(d1Value));
};

export const d1Batch = (database: D1Database, queries: DrizzleSqlQuery[]) => {
	if (!queries.length) return Promise.resolve([]);
	return database.batch(queries.map((query) => d1Statement(database, query)));
};
