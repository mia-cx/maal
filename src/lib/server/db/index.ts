import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema/index.js';

export const getDb = (d1: D1Database) => drizzle(d1, { schema });
