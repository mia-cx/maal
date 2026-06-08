import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/sqlite-core';

export const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

export const createdAt = () =>
	text('created_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`);
export const updatedAt = () =>
	text('updated_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`);

export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export type JsonObject = Record<string, unknown>;
export type JsonArray = unknown[];
