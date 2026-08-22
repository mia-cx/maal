import type { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createMcpTestDatabase, seedMcpHousehold } from './mcp-test-helpers.js';

const authenticateSyncSlot = vi.hoisted(() =>
	vi.fn(async () => ({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		workosUserId: 'user_alice',
		activeOrganizationIds: ['org_family'],
		activeMemberships: [
			{
				membershipId: 'membership_org_family',
				householdId: 'org_family',
				householdName: 'Family',
				roleSlug: 'admin',
				permissions: [
					'households:write',
					'recipes:read',
					'recipes:write',
					'meals:read',
					'meals:write'
				]
			}
		]
	}))
);

vi.mock('$lib/server/sync/auth.js', () => ({ authenticateSyncSlot }));

const { GET, POST, PUT, DELETE } =
	await import('../../src/routes/api/auth-slots/[slot]/mcp-keys/+server.js');

let miniflare: Miniflare;
let database: D1Database;

const routeEvent = (method: string, body?: unknown) =>
	({
		request: new Request('https://maal.test/api/auth-slots/slot/mcp-keys', {
			method,
			...(body === undefined
				? {}
				: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
		}),
		platform: { env: { DB: database } },
		params: { slot: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
		cookies: { get: () => 'sealed' }
	}) as never;

beforeEach(async () => {
	({ miniflare, database } = await createMcpTestDatabase());
	await seedMcpHousehold(database);
});

afterEach(async () => miniflare.dispose());

describe('MCP key management routes', () => {
	test('gates create and reroll on current paid service but leaves list and revoke available', async () => {
		const createdResponse = await POST(
			routeEvent('POST', {
				label: 'Kitchen assistant',
				preset: 'read_only_planner',
				grantMode: 'all',
				scopes: ['households:read', 'recipes:read', 'meals:read'],
				expiresAt: '2026-08-23T12:00:00.000Z'
			})
		);
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as { record: { id: string } };

		await database.prepare("UPDATE billing_subscriptions SET status = 'canceled'").run();
		expect(
			(
				await POST(
					routeEvent('POST', {
						label: 'Blocked assistant',
						grantMode: 'all',
						scopes: ['households:read']
					})
				)
			).status
		).toBe(403);
		expect((await PUT(routeEvent('PUT', { keyId: created.record.id }))).status).toBe(403);
		expect((await GET(routeEvent('GET'))).status).toBe(200);
		expect((await DELETE(routeEvent('DELETE', { keyId: created.record.id }))).status).toBe(200);
	});
});
