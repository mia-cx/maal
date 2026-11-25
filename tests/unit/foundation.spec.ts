import 'fake-indexeddb/auto';

import Dexie, { type EntityTable } from 'dexie';
import { Schema } from 'effect';
import { afterEach, describe, expect, test } from 'vitest';

import { CURRENT_SCHEMA_VERSION, versionedContract } from '$lib/domain/contracts/schema.js';

interface FoundationRecord {
	id: string;
	value: string;
}

class FoundationDatabase extends Dexie {
	records!: EntityTable<FoundationRecord, 'id'>;

	constructor(name: string) {
		super(name);
		this.version(1).stores({ records: 'id' });
	}
}

const openDatabases: FoundationDatabase[] = [];

afterEach(async () => {
	await Promise.all(openDatabases.map((database) => database.delete()));
	openDatabases.length = 0;
});

describe('foundation', () => {
	test('decodes explicitly versioned contracts', () => {
		const schema = versionedContract(Schema.Struct({ id: Schema.String }));

		expect(
			Schema.decodeUnknownSync(schema)({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				payload: { id: 'recipe-id' }
			})
		).toEqual({ schemaVersion: 1, payload: { id: 'recipe-id' } });
	});

	test('supports IndexedDB-backed local persistence', async () => {
		const database = new FoundationDatabase(`maal-foundation-${crypto.randomUUID()}`);
		openDatabases.push(database);

		await database.records.put({ id: 'record-id', value: 'stored locally' });

		await expect(database.records.get('record-id')).resolves.toEqual({
			id: 'record-id',
			value: 'stored locally'
		});
	});
});
