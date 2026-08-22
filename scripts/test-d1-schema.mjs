import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const persistenceDirectory = mkdtempSync(join(tmpdir(), 'maal-d1-schema-'));
const wrangler = ['exec', 'wrangler', 'd1'];
const databaseName = 'maal-local';

const run = (args, expectedSuccess = true) => {
	const result = spawnSync('pnpm', [...wrangler, ...args, '--persist-to', persistenceDirectory], {
		encoding: 'utf8',
		stdio: 'pipe'
	});
	if ((result.status === 0) !== expectedSuccess) {
		throw new Error(
			`D1 schema proof failed (${args.join(' ')}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
		);
	}
};

try {
	run(['migrations', 'apply', databaseName, '--local']);
	run([
		'execute',
		databaseName,
		'--local',
		'--command',
		"INSERT INTO users (workos_user_id) VALUES ('user_1'), ('user_2'); INSERT INTO households (household_id, created_by_user_id) VALUES ('org_1', 'user_1'), ('org_2', 'user_2');"
	]);
	run(
		[
			'execute',
			databaseName,
			'--local',
			'--command',
			"INSERT INTO meals (id, household_id, title, status) VALUES ('meal_bad_status', 'org_1', 'Soup', 'postponed');"
		],
		false
	);
	run(
		[
			'execute',
			databaseName,
			'--local',
			'--command',
			"INSERT INTO household_memberships (membership_id, household_id, workos_user_id, role_slug, permissions, status, workos_created_at, last_verified_at) VALUES ('membership_1', 'org_1', 'user_1', 'admin', 'not-json', 'active', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z');"
		],
		false
	);
	run([
		'execute',
		databaseName,
		'--local',
		'--command',
		"INSERT INTO billing_trial_claims (id, workos_user_id, household_id, state, reserved_at) VALUES ('trial_1', 'user_1', 'org_1', 'reserved', '2026-08-21T00:00:00Z');"
	]);
	run(
		[
			'execute',
			databaseName,
			'--local',
			'--command',
			"INSERT INTO billing_trial_claims (id, workos_user_id, household_id, state, reserved_at) VALUES ('trial_2', 'user_1', 'org_2', 'reserved', '2026-08-21T00:00:00Z');"
		],
		false
	);
	run(
		[
			'execute',
			databaseName,
			'--local',
			'--command',
			"INSERT INTO billing_trial_claims (id, workos_user_id, household_id, state, reserved_at) VALUES ('trial_3', 'user_2', 'org_1', 'reserved', '2026-08-21T00:00:00Z');"
		],
		false
	);
} finally {
	rmSync(persistenceDirectory, { recursive: true, force: true });
}
