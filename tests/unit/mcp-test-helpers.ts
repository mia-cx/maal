import { Miniflare } from 'miniflare';
import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

export const MCP_TEST_NOW = '2026-08-22T12:00:00.000Z';
export const MCP_TEST_USER = 'user_alice';
export const MCP_TEST_HOUSEHOLD = 'org_family';
export const MCP_TEST_PERMISSIONS = [
	'households:write',
	'recipes:read',
	'recipes:write',
	'meals:read',
	'meals:write'
] as const;

export const createMcpTestDatabase = async (): Promise<{
	miniflare: Miniflare;
	database: D1Database;
}> => {
	const miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	const database = await miniflare.getD1Database('DB');
	await applyD1Migrations(database, await readD1MigrationFiles());
	return { miniflare, database };
};

export const seedMcpHousehold = async (
	database: D1Database,
	input: {
		householdId?: string;
		membershipId?: string;
		billingStatus?: string;
		graceUntil?: string | null;
	} = {}
): Promise<void> => {
	const householdId = input.householdId ?? MCP_TEST_HOUSEHOLD;
	const membershipId = input.membershipId ?? `membership_${householdId}`;
	await database
		.prepare('INSERT OR IGNORE INTO users (workos_user_id) VALUES (?)')
		.bind(MCP_TEST_USER)
		.run();
	await database
		.prepare('INSERT INTO households (household_id, created_by_user_id) VALUES (?, ?)')
		.bind(householdId, MCP_TEST_USER)
		.run();
	await database
		.prepare(
			`INSERT INTO household_memberships
			 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
			  workos_created_at, last_verified_at)
			 VALUES (?, ?, ?, 'admin', ?, 'active', ?, ?)`
		)
		.bind(
			membershipId,
			householdId,
			MCP_TEST_USER,
			JSON.stringify(MCP_TEST_PERMISSIONS),
			MCP_TEST_NOW,
			MCP_TEST_NOW
		)
		.run();
	await database
		.prepare(
			`INSERT INTO billing_subscriptions
			 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
			  current_period_end, grace_until)
			 VALUES (?, ?, ?, 'price_maal', ?, '2026-09-22T12:00:00.000Z', ?)`
		)
		.bind(
			householdId,
			`cus_${householdId}`,
			`sub_${householdId}`,
			input.billingStatus ?? 'active',
			input.graceUntil ?? null
		)
		.run();
};
