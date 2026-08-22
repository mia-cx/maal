import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { applyD1Migrations, readD1MigrationFiles } from './d1-test-migrations.js';

const liveMemberships = vi.hoisted(() => vi.fn());
const authenticate = vi.hoisted(() =>
	vi.fn(async () => ({
		authenticated: true as const,
		sessionId: 'session_test',
		organizationId: null,
		user: {
			id: 'user_alice',
			email: 'alice@example.test',
			firstName: 'Alice',
			lastName: null,
			profilePictureUrl: null
		}
	}))
);

vi.mock('$lib/server/auth-slots/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/auth-slots/index.js')>()),
	authSlotAdapterFor: () => ({ authenticate, listActiveMemberships: liveMemberships })
}));

const { requireBillingActor } = await import('$lib/server/billing/auth.js');

let miniflare: Miniflare;
let database: D1Database;
const timestamp = '2026-08-22T09:00:00.000Z';

beforeEach(async () => {
	miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-07-15',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: ['DB']
	});
	database = await miniflare.getD1Database('DB');
	await applyD1Migrations(database, await readD1MigrationFiles());
	await database.prepare("INSERT INTO users (workos_user_id) VALUES ('user_alice')").run();
	await database
		.prepare("INSERT INTO households (household_id, name) VALUES ('org_family', 'Family')")
		.run();
	await database
		.prepare(
			`INSERT INTO household_memberships
			 (membership_id, household_id, workos_user_id, role_slug, permissions, status,
			  workos_created_at, last_verified_at)
			 VALUES ('membership_alice', 'org_family', 'user_alice', 'admin', ?, 'active', ?, ?)`
		)
		.bind(JSON.stringify(['households:write']), timestamp, timestamp)
		.run();
	liveMemberships.mockReset();
});

afterEach(async () => miniflare.dispose());

const event = () =>
	({
		params: { slot: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
		cookies: { get: () => 'sealed-session' },
		platform: { env: { DB: database } }
	}) as never;

describe('billing live membership authorization', () => {
	test('requires the same live membership ID, role, and permission as the D1 projection', async () => {
		liveMemberships.mockResolvedValue([
			{
				membershipId: 'membership_alice',
				householdId: 'org_family',
				householdName: 'Family',
				roleSlug: 'admin',
				permissions: ['households:write']
			}
		]);
		await expect(requireBillingActor(event(), 'org_family')).resolves.toMatchObject({
			workosUserId: 'user_alice'
		});

		liveMemberships.mockResolvedValue([
			{
				membershipId: 'membership_alice',
				householdId: 'org_family',
				householdName: 'Family',
				roleSlug: 'member',
				permissions: []
			}
		]);
		await expect(requireBillingActor(event(), 'org_family')).rejects.toMatchObject({
			_tag: 'BillingAuthorizationError',
			reason: 'permission_denied'
		});
	});
});
