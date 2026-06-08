import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema/index';

export const getDb = (d1: D1Database) => drizzle(d1, { schema });
