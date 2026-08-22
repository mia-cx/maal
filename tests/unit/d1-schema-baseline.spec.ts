import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, test } from 'vitest';

import {
	GLOBAL_FOOD_ALIAS_SEED,
	GLOBAL_FOOD_SEED,
	GLOBAL_UNIT_ALIAS_SEED,
	GLOBAL_UNIT_SEED
} from '$lib/domain/taxonomy/global-seed.js';

import {
	applyD1Migration,
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
	test('contains a generated baseline and deterministic taxonomy seed migration', async () => {
		const migrations = await readD1MigrationFiles();
		expect(migrations.map(({ name }) => name)).toEqual([
			'0000_rewrite_baseline.sql',
			'0001_global_taxonomy_seed.sql'
		]);

		const database = await createDatabase();
		await applyD1Migrations(database, migrations);

		await expect(schemaFingerprint(database)).resolves.toEqual({
			objects: 138,
			tables: 55,
			indexes: 83,
			sha256: PRE_BASELINE_SCHEMA_FINGERPRINT
		});
	});

	test('installs the canonical global taxonomy seeds without drift', async () => {
		expect(GLOBAL_UNIT_SEED).toHaveLength(40);
		expect(GLOBAL_UNIT_ALIAS_SEED).toHaveLength(184);
		expect(GLOBAL_FOOD_SEED).toHaveLength(0);
		expect(GLOBAL_FOOD_ALIAS_SEED).toHaveLength(0);

		const database = await createDatabase();
		await applyD1Migrations(database, await readD1MigrationFiles());
		const units = await database
			.prepare('SELECT id, base_unit_id, to_base_factor, to_base_offset FROM units ORDER BY id')
			.all();
		const aliases = await database
			.prepare(
				`SELECT id, unit_id, base_unit_id, alias, plural_alias, locale, source_domain,
				        default_for_locale, created_at, updated_at
				 FROM unit_aliases ORDER BY id`
			)
			.all();

		expect(units.results).toEqual(
			[...GLOBAL_UNIT_SEED]
				.sort((left, right) => left.id.localeCompare(right.id))
				.map((unit) => ({
					id: unit.id,
					base_unit_id: unit.baseUnitId,
					to_base_factor: unit.toBaseFactor,
					to_base_offset: unit.toBaseOffset
				}))
		);
		expect(aliases.results).toEqual(
			[...GLOBAL_UNIT_ALIAS_SEED]
				.sort((left, right) => left.id.localeCompare(right.id))
				.map((alias) => ({
					id: alias.id,
					unit_id: alias.unitId,
					base_unit_id: alias.baseUnitId,
					alias: alias.alias,
					plural_alias: alias.pluralAlias,
					locale: alias.locale,
					source_domain: alias.sourceDomain,
					default_for_locale: alias.defaultForLocale ? 1 : 0,
					created_at: alias.createdAt,
					updated_at: alias.updatedAt
				}))
		);
		expect(units.results).toContainEqual({
			id: 'fahrenheit',
			base_unit_id: 'celsius',
			to_base_factor: 0.555555555555556,
			to_base_offset: -17.7777777777778
		});
		expect(aliases.results).toContainEqual(
			expect.objectContaining({
				unit_id: 'cloves',
				alias: 'teentje',
				plural_alias: 'teentjes',
				locale: 'nl-NL'
			})
		);
	});

	test('rejects a populated prototype schema without changing its data', async () => {
		const database = await createDatabase();
		await database.batch([
			database.prepare('CREATE TABLE users (workos_user_id text PRIMARY KEY NOT NULL)'),
			database.prepare(
				'CREATE TABLE households (household_id text PRIMARY KEY NOT NULL, created_by_user_id text)'
			),
			database.prepare(
				'CREATE TABLE user_recipes (id text PRIMARY KEY NOT NULL, workos_user_id text NOT NULL, title text NOT NULL)'
			),
			database.prepare(
				'CREATE TABLE household_meals (id text PRIMARY KEY NOT NULL, household_id text NOT NULL, title text NOT NULL)'
			),
			database.prepare("INSERT INTO users VALUES ('user_prototype')"),
			database.prepare("INSERT INTO households VALUES ('org_prototype', 'user_prototype')"),
			database.prepare(
				"INSERT INTO user_recipes VALUES ('recipe_prototype', 'user_prototype', 'Soup')"
			),
			database.prepare(
				"INSERT INTO household_meals VALUES ('meal_prototype', 'org_prototype', 'Soup night')"
			)
		]);

		const [baseline] = await readD1MigrationFiles();
		await expect(applyD1Migration(database, baseline!)).rejects.toThrow();
		await expect(database.prepare('SELECT workos_user_id FROM users').all()).resolves.toMatchObject(
			{ results: [{ workos_user_id: 'user_prototype' }] }
		);
		await expect(database.prepare('SELECT id FROM user_recipes').all()).resolves.toMatchObject({
			results: [{ id: 'recipe_prototype' }]
		});
		await expect(
			database.prepare("SELECT name FROM sqlite_schema WHERE name = 'household_appliances'").first()
		).resolves.toBeNull();
	});
});
