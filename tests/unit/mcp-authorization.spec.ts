import type { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LiveWorkOSMembership } from '$lib/server/auth-slots/adapter.js';
import {
	MAAL_API_SCOPES,
	McpKeyRepository,
	authorizeMcpRequest,
	hashMcpKey,
	mcpAuthorizationResponse,
	presetScopes
} from '$lib/server/mcp/index.js';

import {
	MCP_TEST_HOUSEHOLD,
	MCP_TEST_NOW,
	MCP_TEST_PERMISSIONS,
	MCP_TEST_USER,
	createMcpTestDatabase,
	seedMcpHousehold
} from './mcp-test-helpers.js';

let miniflare: Miniflare;
let database: D1Database;
let repository: McpKeyRepository;

const membership = (
	householdId = MCP_TEST_HOUSEHOLD,
	membershipId = `membership_${householdId}`,
	permissions: readonly string[] = MCP_TEST_PERMISSIONS
): LiveWorkOSMembership => ({
	membershipId,
	householdId,
	householdName: householdId === MCP_TEST_HOUSEHOLD ? 'Family' : 'Future family',
	roleSlug: 'admin',
	permissions
});

const environment = (): Env => ({ DB: database }) as Env;
const requestFor = (rawKey?: string): Request =>
	new Request('https://maal.test/mcp', {
		method: 'POST',
		headers: rawKey === undefined ? {} : { authorization: `Bearer ${rawKey}` }
	});

const createKey = async (overrides: Partial<Parameters<McpKeyRepository['create']>[0]> = {}) =>
	repository.create({
		ownerUserId: MCP_TEST_USER,
		label: 'Kitchen assistant',
		preset: 'full_access',
		grantMode: 'all',
		scopes: MAAL_API_SCOPES,
		now: MCP_TEST_NOW,
		...overrides
	});

const authorize = (
	rawKey: string,
	liveMemberships: readonly LiveWorkOSMembership[] = [membership()],
	now = MCP_TEST_NOW
) =>
	authorizeMcpRequest({
		request: requestFor(rawKey),
		environment: environment(),
		now,
		membershipProvider: { listActiveMemberships: async () => liveMemberships }
	});

beforeEach(async () => {
	({ miniflare, database } = await createMcpTestDatabase());
	await seedMcpHousehold(database);
	repository = new McpKeyRepository(database);
});

afterEach(async () => {
	await miniflare.dispose();
});

describe('MCP key lifecycle', () => {
	test('stores only a SHA-256 hash and returns the raw key once', async () => {
		const created = await createKey({
			grantMode: 'selected',
			selectedHouseholdIds: [MCP_TEST_HOUSEHOLD]
		});
		expect(created.key).toMatch(/^mk_[A-Za-z0-9_-]{43}$/);
		const row = await database
			.prepare('SELECT key_hash, scopes FROM mcp_keys WHERE id = ?')
			.bind(created.record.id)
			.first<{ key_hash: string; scopes: string }>();
		expect(row?.key_hash).toBe(await hashMcpKey(created.key));
		expect(JSON.stringify(row)).not.toContain(created.key);
		expect(await repository.list(MCP_TEST_USER)).toEqual([
			expect.objectContaining({
				id: created.record.id,
				householdScope: { kind: 'households', householdIds: [MCP_TEST_HOUSEHOLD] }
			})
		]);
	});

	test('rerolls atomically and revokes the old secret', async () => {
		const created = await createKey();
		const rerolled = await repository.reroll(
			MCP_TEST_USER,
			created.record.id,
			'2026-08-22T12:01:00.000Z'
		);
		expect(rerolled?.key).not.toBe(created.key);
		expect((await repository.byRawKey(created.key))?.revokedAt).toBe('2026-08-22T12:01:00.000Z');
		expect((await repository.byRawKey(rerolled!.key))?.revokedAt).toBeNull();
	});

	test('allows only one winner when two rerolls race', async () => {
		const created = await createKey({
			grantMode: 'selected',
			selectedHouseholdIds: [MCP_TEST_HOUSEHOLD]
		});
		const results = await Promise.all([
			repository.reroll(MCP_TEST_USER, created.record.id, '2026-08-22T12:01:00.000Z'),
			repository.reroll(MCP_TEST_USER, created.record.id, '2026-08-22T12:01:00.001Z')
		]);
		expect(results.filter((result) => result !== null)).toHaveLength(1);
		const listed = await repository.list(MCP_TEST_USER);
		expect(listed.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(1);
		expect(listed.find(({ revokedAt }) => revokedAt === null)?.selectedHouseholdIds).toEqual([
			MCP_TEST_HOUSEHOLD
		]);
	});

	test('keeps all ten scopes and all three presets exact', () => {
		expect(MAAL_API_SCOPES).toHaveLength(10);
		expect(presetScopes('read_only_planner')).toEqual([
			'households:read',
			'recipes:read',
			'meals:read'
		]);
		expect(presetScopes('meal_planner')).toEqual([
			'households:read',
			'recipes:read',
			'meals:read',
			'meals:write',
			'check_ins:write'
		]);
		expect(presetScopes('full_access')).toEqual(MAAL_API_SCOPES);
	});
});

describe('MCP request authorization', () => {
	test('uses only the Authorization header and returns safe no-store challenges', async () => {
		const querySecret = `mk_${'q'.repeat(43)}`;
		const queryOnly = new Request(`https://maal.test/mcp?api_key=${querySecret}`, {
			method: 'POST'
		});
		let cause: unknown;
		try {
			await authorizeMcpRequest({
				request: queryOnly,
				environment: environment(),
				now: MCP_TEST_NOW,
				membershipProvider: { listActiveMemberships: async () => [membership()] }
			});
		} catch (error) {
			cause = error;
		}
		const response = mcpAuthorizationResponse(cause);
		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('www-authenticate')).toContain('invalid_token');
		expect(await response.text()).not.toContain(querySecret);
	});

	test.each([
		['missing', requestFor()],
		['malformed', requestFor('not-an-mcp-key')],
		['unknown', requestFor(`mk_${'a'.repeat(43)}`)]
	])('rejects %s credentials without leaking the secret', async (_case, request) => {
		const result = authorizeMcpRequest({
			request,
			environment: environment(),
			now: MCP_TEST_NOW,
			membershipProvider: { listActiveMemberships: async () => [membership()] }
		});
		await expect(result).rejects.toMatchObject({ _tag: 'McpAuthenticationError' });
		await expect(result).rejects.not.toHaveProperty('rawKey');
	});

	test('rejects revoked and expired keys, then updates last use for a valid key', async () => {
		const revoked = await createKey();
		await repository.revoke(MCP_TEST_USER, revoked.record.id, MCP_TEST_NOW);
		await expect(authorize(revoked.key)).rejects.toMatchObject({
			_tag: 'McpAuthenticationError'
		});

		const expired = await createKey({ expiresAt: '2026-08-22T11:59:59.000Z' });
		await expect(authorize(expired.key)).rejects.toMatchObject({
			_tag: 'McpAuthenticationError'
		});

		const active = await createKey();
		await expect(authorize(active.key)).resolves.toMatchObject({
			ownerUserId: MCP_TEST_USER,
			authenticatedAt: MCP_TEST_NOW
		});
		expect((await repository.byId(MCP_TEST_USER, active.record.id))?.lastUsedAt).toBe(MCP_TEST_NOW);
	});

	test('supports selected grants and dynamic all grants for households joined later', async () => {
		const selected = await createKey({
			grantMode: 'selected',
			selectedHouseholdIds: [MCP_TEST_HOUSEHOLD]
		});
		const all = await createKey();
		const future = 'org_future';
		await seedMcpHousehold(database, { householdId: future });
		const live = [membership(), membership(future)];
		expect(
			(await authorize(selected.key, live)).effectiveHouseholds.map((row) => row.householdId)
		).toEqual([MCP_TEST_HOUSEHOLD]);
		expect(
			(await authorize(all.key, live)).effectiveHouseholds.map((row) => row.householdId).sort()
		).toEqual([MCP_TEST_HOUSEHOLD, future].sort());
	});

	test.each([
		['active', null, true],
		['trialing', null, true],
		['past_due', '2026-09-22T12:00:00.000Z', true],
		['paused', '2026-09-22T12:00:00.000Z', true],
		['past_due', '2026-08-22T11:59:59.000Z', false],
		['paused', null, false],
		['canceled', null, false],
		['unpaid', null, false]
	])('applies %s billing capability with grace %s', async (status, graceUntil, allowed) => {
		await database
			.prepare('UPDATE billing_subscriptions SET status = ?, grace_until = ?')
			.bind(status, graceUntil)
			.run();
		const created = await createKey();
		if (allowed) {
			await expect(authorize(created.key)).resolves.toMatchObject({ ownerUserId: MCP_TEST_USER });
		} else {
			await expect(authorize(created.key)).rejects.toMatchObject({
				_tag: 'McpAuthorizationError'
			});
		}
	});

	test('rechecks WorkOS, D1 role, key grant, revocation, plan, and deletion on the next request', async () => {
		const created = await createKey({
			grantMode: 'selected',
			selectedHouseholdIds: [MCP_TEST_HOUSEHOLD]
		});
		await expect(authorize(created.key)).resolves.toBeDefined();
		await expect(authorize(created.key, [])).rejects.toMatchObject({
			_tag: 'McpAuthorizationError'
		});

		await database.prepare("UPDATE household_memberships SET role_slug = 'member'").run();
		await expect(authorize(created.key)).rejects.toMatchObject({ _tag: 'McpAuthorizationError' });
		await database.prepare("UPDATE household_memberships SET role_slug = 'admin'").run();

		await database
			.prepare('DELETE FROM mcp_key_households WHERE key_id = ?')
			.bind(created.record.id)
			.run();
		await expect(authorize(created.key)).rejects.toMatchObject({ _tag: 'McpAuthorizationError' });
		await database
			.prepare('INSERT INTO mcp_key_households (key_id, household_id) VALUES (?, ?)')
			.bind(created.record.id, MCP_TEST_HOUSEHOLD)
			.run();

		await database.prepare("UPDATE billing_subscriptions SET status = 'canceled'").run();
		await expect(authorize(created.key)).rejects.toMatchObject({ _tag: 'McpAuthorizationError' });
		await database.prepare("UPDATE billing_subscriptions SET status = 'active'").run();

		await database
			.prepare(
				`INSERT INTO household_deletion_requests
				 (household_id, requester_user_id, state, requested_at)
				 VALUES (?, ?, 'requested', ?)`
			)
			.bind(MCP_TEST_HOUSEHOLD, MCP_TEST_USER, MCP_TEST_NOW)
			.run();
		await expect(authorize(created.key)).rejects.toMatchObject({ _tag: 'McpAuthorizationError' });
		await database.prepare('DELETE FROM household_deletion_requests').run();

		await repository.revoke(MCP_TEST_USER, created.record.id, MCP_TEST_NOW);
		await expect(authorize(created.key)).rejects.toMatchObject({ _tag: 'McpAuthenticationError' });
	});

	test('fails closed when WorkOS or D1 authorization is unavailable', async () => {
		const created = await createKey();
		await expect(
			authorizeMcpRequest({
				request: requestFor(created.key),
				environment: environment(),
				now: MCP_TEST_NOW,
				membershipProvider: {
					listActiveMemberships: async () => {
						throw new Error('private provider detail');
					}
				}
			})
		).rejects.toMatchObject({
			_tag: 'McpAuthorizationUnavailable',
			code: 'workos_unavailable'
		});

		const failingDatabase = {
			prepare: () => {
				throw new Error('private D1 detail');
			}
		} as unknown as D1Database;
		await expect(
			authorizeMcpRequest({
				request: requestFor(created.key),
				environment: { DB: failingDatabase } as Env,
				now: MCP_TEST_NOW,
				membershipProvider: { listActiveMemberships: async () => [membership()] }
			})
		).rejects.toMatchObject({
			_tag: 'McpAuthorizationUnavailable',
			code: 'd1_unavailable'
		});
	});
});
