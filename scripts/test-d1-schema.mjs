import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const emptyPersistenceDirectory = mkdtempSync(join(tmpdir(), 'maal-d1-schema-empty-'));
const prototypePersistenceDirectory = mkdtempSync(join(tmpdir(), 'maal-d1-schema-prototype-'));
const wrangler = ['exec', 'wrangler', 'd1'];
const databaseName = 'maal-local';
const expectedMigrations = ['0000_rewrite_baseline.sql', '0001_global_taxonomy_seed.sql'];

const run = (persistenceDirectory, args, expectedSuccess = true) => {
	const result = spawnSync('pnpm', [...wrangler, ...args, '--persist-to', persistenceDirectory], {
		encoding: 'utf8',
		stdio: 'pipe'
	});
	if ((result.status === 0) !== expectedSuccess) {
		throw new Error(
			`D1 schema proof failed (${args.join(' ')}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
		);
	}
	return result;
};

const execute = (persistenceDirectory, command, expectedSuccess = true) =>
	run(
		persistenceDirectory,
		['execute', databaseName, '--local', '--command', command],
		expectedSuccess
	);

const query = (persistenceDirectory, command) => {
	const result = run(persistenceDirectory, [
		'execute',
		databaseName,
		'--local',
		'--command',
		command,
		'--json'
	]);
	return JSON.parse(result.stdout)[0].results;
};

try {
	assert.deepEqual(
		readdirSync('drizzle')
			.filter((name) => name.endsWith('.sql'))
			.sort(),
		expectedMigrations
	);

	run(emptyPersistenceDirectory, ['migrations', 'apply', databaseName, '--local']);
	const pending = run(emptyPersistenceDirectory, ['migrations', 'list', databaseName, '--local']);
	assert.match(pending.stdout, /No migrations to apply/);
	assert.deepEqual(
		query(emptyPersistenceDirectory, 'SELECT name FROM d1_migrations ORDER BY id'),
		expectedMigrations.map((name) => ({ name }))
	);
	assert.deepEqual(
		query(
			emptyPersistenceDirectory,
			`SELECT
			   (SELECT COUNT(*) FROM units) AS units,
			   (SELECT COUNT(*) FROM unit_aliases) AS unit_aliases,
			   (SELECT COUNT(*) FROM foods) AS foods,
			   (SELECT COUNT(*) FROM food_aliases) AS food_aliases`
		),
		[{ units: 40, unit_aliases: 184, foods: 0, food_aliases: 0 }]
	);
	assert.deepEqual(
		query(
			emptyPersistenceDirectory,
			`SELECT id, base_unit_id, to_base_factor, to_base_offset
			 FROM units WHERE id IN ('fahrenheit', 'kilograms') ORDER BY id`
		),
		[
			{
				id: 'fahrenheit',
				base_unit_id: 'celsius',
				to_base_factor: 0.555555555555556,
				to_base_offset: -17.7777777777778
			},
			{ id: 'kilograms', base_unit_id: 'grams', to_base_factor: 1000, to_base_offset: 0 }
		]
	);
	assert.deepEqual(
		query(
			emptyPersistenceDirectory,
			`SELECT unit_id, base_unit_id, alias, plural_alias, locale
			 FROM unit_aliases WHERE alias IN ('teentje', 'tablespoon') ORDER BY alias`
		),
		[
			{
				unit_id: 'tablespoons',
				base_unit_id: 'milliliters',
				alias: 'tablespoon',
				plural_alias: 'tablespoons',
				locale: 'en-US'
			},
			{
				unit_id: 'cloves',
				base_unit_id: 'cloves',
				alias: 'teentje',
				plural_alias: 'teentjes',
				locale: 'nl-NL'
			}
		]
	);

	execute(
		emptyPersistenceDirectory,
		"INSERT INTO users (workos_user_id) VALUES ('user_1'), ('user_2'); INSERT INTO households (household_id, created_by_user_id) VALUES ('org_1', 'user_1'), ('org_2', 'user_2');"
	);
	execute(
		emptyPersistenceDirectory,
		"INSERT INTO meals (id, household_id, title, status) VALUES ('meal_bad_status', 'org_1', 'Soup', 'postponed');",
		false
	);
	execute(
		emptyPersistenceDirectory,
		"INSERT INTO household_memberships (membership_id, household_id, workos_user_id, role_slug, permissions, status, workos_created_at, last_verified_at) VALUES ('membership_1', 'org_1', 'user_1', 'admin', 'not-json', 'active', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z');",
		false
	);
	execute(
		emptyPersistenceDirectory,
		"INSERT INTO billing_trial_claims (id, workos_user_id, household_id, state, reserved_at) VALUES ('trial_1', 'user_1', 'org_1', 'reserved', '2026-08-21T00:00:00Z');"
	);
	execute(
		emptyPersistenceDirectory,
		"INSERT INTO billing_trial_claims (id, workos_user_id, household_id, state, reserved_at) VALUES ('trial_2', 'user_1', 'org_2', 'reserved', '2026-08-21T00:00:00Z');",
		false
	);
	execute(
		emptyPersistenceDirectory,
		"INSERT INTO billing_trial_claims (id, workos_user_id, household_id, state, reserved_at) VALUES ('trial_3', 'user_2', 'org_1', 'reserved', '2026-08-21T00:00:00Z');",
		false
	);

	execute(
		prototypePersistenceDirectory,
		`CREATE TABLE users (workos_user_id text PRIMARY KEY NOT NULL);
		 CREATE TABLE households (household_id text PRIMARY KEY NOT NULL, created_by_user_id text);
		 CREATE TABLE user_recipes (id text PRIMARY KEY NOT NULL, workos_user_id text NOT NULL, title text NOT NULL);
		 CREATE TABLE household_meals (id text PRIMARY KEY NOT NULL, household_id text NOT NULL, title text NOT NULL);
		 INSERT INTO users VALUES ('user_prototype');
		 INSERT INTO households VALUES ('org_prototype', 'user_prototype');
		 INSERT INTO user_recipes VALUES ('recipe_prototype', 'user_prototype', 'Soup');
		 INSERT INTO household_meals VALUES ('meal_prototype', 'org_prototype', 'Soup night');`
	);
	run(prototypePersistenceDirectory, ['migrations', 'apply', databaseName, '--local'], false);
	assert.deepEqual(
		query(
			prototypePersistenceDirectory,
			`SELECT
			   (SELECT COUNT(*) FROM users WHERE workos_user_id = 'user_prototype') AS users,
			   (SELECT COUNT(*) FROM user_recipes WHERE id = 'recipe_prototype') AS recipes,
			   (SELECT COUNT(*) FROM household_meals WHERE id = 'meal_prototype') AS meals,
			   (SELECT COUNT(*) FROM sqlite_schema WHERE name = 'household_appliances') AS rewrite_tables,
			   (SELECT COUNT(*) FROM d1_migrations) AS applied_migrations`
		),
		[{ users: 1, recipes: 1, meals: 1, rewrite_tables: 0, applied_migrations: 0 }]
	);
} finally {
	rmSync(emptyPersistenceDirectory, { recursive: true, force: true });
	rmSync(prototypePersistenceDirectory, { recursive: true, force: true });
}
