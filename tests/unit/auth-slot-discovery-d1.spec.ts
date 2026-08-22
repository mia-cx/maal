import { readFile } from 'node:fs/promises';

import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { discoverActiveHouseholds } from '$lib/server/auth-slots/discovery.js';

let miniflare: Miniflare;
let database: D1Database;
const now = '2026-08-22T09:00:00.000Z';

const applyMigration = async (path: string): Promise<void> => {
	const source = await readFile(path, 'utf8');
	for (const statement of source
		.split('--> statement-breakpoint')
		.map((part) => part.trim())
		.filter(Boolean)) {
		await database.prepare(statement).run();
	}
};

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	for (const migration of [
		'drizzle/0000_quick_hitman.sql',
		'drizzle/0001_long_mysterio.sql',
		'drizzle/0002_naive_the_liberteens.sql',
		'drizzle/0003_glossy_leader.sql',
		'drizzle/0004_right_sway.sql',
		'drizzle/0005_needy_khan.sql'
	]) {
		await applyMigration(migration);
	}
});

afterEach(async () => miniflare.dispose());

describe('authenticated household discovery', () => {
	test('projects the exact live WorkOS membership and current paid capability for a fresh device', async () => {
		await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
		await database.prepare("INSERT INTO households (household_id) VALUES ('org_family')").run();
		await database
			.prepare(
				`INSERT INTO billing_subscriptions
				 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
				  subscriber_user_id, current_period_end)
				 VALUES ('org_family', 'cus_family', 'sub_family', 'price_monthly', 'active',
				         'user_alice', '2026-09-22T09:00:00.000Z')`
			)
			.run();

		const [entry] = await discoverActiveHouseholds({
			database,
			workosUserId: 'user_alice',
			liveMemberships: [
				{
					membershipId: 'membership_alice',
					householdId: 'org_family',
					householdName: 'Family kitchen',
					roleSlug: 'admin',
					permissions: ['households:write', 'meals:read', 'unknown:permission'],
					workosCreatedAt: now
				}
			],
			now
		});

		expect(entry).toMatchObject({
			household: { householdId: 'org_family', name: 'Family kitchen', localOnly: false },
			membership: {
				membershipId: 'membership_alice',
				roleSlug: 'admin',
				permissions: ['households:write', 'meals:read']
			},
			capability: { householdId: 'org_family', state: 'enabled', stripeStatus: 'active' }
		});
		await expect(
			database
				.prepare(
					'SELECT membership_id, role_slug, permissions FROM household_memberships WHERE household_id = ?'
				)
				.bind('org_family')
				.first()
		).resolves.toMatchObject({
			membership_id: 'membership_alice',
			role_slug: 'admin',
			permissions: JSON.stringify(['households:write', 'meals:read'])
		});
	});

	test('requires a distinct post-recovery subscription before rediscovering paid capability', async () => {
		await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
		await database.prepare("INSERT INTO households (household_id) VALUES ('org_family')").run();
		await database
			.prepare(
				`INSERT INTO billing_subscriptions
				 (household_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
				  current_period_end)
				 VALUES ('org_family', 'cus_family', 'sub_cancelled', 'price_monthly', 'active',
				         '2026-09-22T09:00:00.000Z')`
			)
			.run();
		await database
			.prepare(
				`INSERT INTO household_deletion_requests
				 (household_id, requester_user_id, state, stripe_cancellation_id, requested_at)
				 VALUES ('org_family', 'user_alice', 'recovered', 'sub_cancelled', ?)`
			)
			.bind(now)
			.run();

		const [entry] = await discoverActiveHouseholds({
			database,
			workosUserId: 'user_alice',
			liveMemberships: [
				{
					membershipId: 'membership_alice',
					householdId: 'org_family',
					householdName: 'Family',
					roleSlug: 'member',
					permissions: ['meals:read']
				}
			],
			now
		});

		expect(entry).toMatchObject({
			household: { deletionState: 'active' },
			capability: { state: 'disabled' }
		});

		await database
			.prepare(
				"UPDATE billing_subscriptions SET stripe_subscription_id = 'sub_restarted' WHERE household_id = 'org_family'"
			)
			.run();
		const [restarted] = await discoverActiveHouseholds({
			database,
			workosUserId: 'user_alice',
			liveMemberships: [
				{
					membershipId: 'membership_alice',
					householdId: 'org_family',
					householdName: 'Family',
					roleSlug: 'member',
					permissions: ['meals:read']
				}
			],
			now
		});
		expect(restarted?.capability.state).toBe('enabled');
	});
});
