import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, test } from 'vitest';

import {
	applyD1Migrations,
	readD1MigrationFiles,
	schemaFingerprint
} from './d1-test-migrations.js';

const PRE_BASELINE_SCHEMA_FINGERPRINT =
	'530668bba4bd77fdb5f355a4f0ab25e2808bbd36c663bd182fff15fdc782752e';

const instances: Miniflare[] = [];

const createDatabase = async (): Promise<D1Database> => {
	const miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	instances.push(miniflare);
	return miniflare.getD1Database('DB');
};

afterEach(async () => {
	await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe('rewrite D1 migration baseline', () => {
	test('contains one generated baseline with the pre-baseline schema fingerprint', async () => {
		const migrations = await readD1MigrationFiles();
		expect(migrations.map(({ name }) => name)).toEqual([expect.stringMatching(/^0000_.+\.sql$/)]);

		const database = await createDatabase();
		await applyD1Migrations(database, migrations);

		await expect(schemaFingerprint(database)).resolves.toEqual({
			objects: 138,
			tables: 55,
			indexes: 83,
			sha256: PRE_BASELINE_SCHEMA_FINGERPRINT
		});
	});
});
