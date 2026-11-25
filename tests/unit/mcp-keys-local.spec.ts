import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';

import {
	createMcpKey,
	listCachedMcpKeys,
	listMcpKeys,
	rerollMcpKey,
	revokeMcpKey
} from '$lib/client/mcp-keys.js';
import { openMaalDatabase, type MaalDatabase } from '$lib/client/local/index.js';

let database: MaalDatabase | null = null;

afterEach(async () => {
	if (!database) return;
	const name = database.name;
	database.close();
	await Dexie.delete(name);
	database = null;
});

const setupProfile = async (): Promise<{ database: MaalDatabase; profileId: string }> => {
	database = await openMaalDatabase(`mcp-keys-${crypto.randomUUID()}`);
	const profileId = uuidv7();
	await database.profiles.put({
		profileId,
		workosUserId: 'user_alice',
		displayName: 'Alice',
		email: 'alice@example.test',
		profilePictureUrl: null,
		locale: 'en-NL',
		timezone: 'Europe/Amsterdam',
		pinSalt: null,
		pinVerifier: null,
		lockPolicy: 'none',
		lastUsedAt: '2026-08-21T12:00:00.000Z',
		authState: 'authenticated'
	});
	await database.authSlots.put({
		authSlotId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		profileId,
		workosUserId: 'user_alice',
		sessionState: 'authenticated',
		lastRefreshedAt: null,
		lastVerifiedAt: null,
		nextRetryAt: null,
		retryCount: 0
	});
	return { database, profileId };
};

const publicRecord = (id: string, revokedAt: string | null = null) => ({
	id,
	label: 'Kitchen agent',
	preset: 'meal_planner' as const,
	grantMode: 'selected' as const,
	scopes: [
		'households:read',
		'recipes:read',
		'meals:read',
		'meals:write',
		'check_ins:write'
	] as const,
	selectedHouseholdIds: ['org_kitchen'],
	createdAt: '2026-08-21T12:00:00.000Z',
	expiresAt: null,
	revokedAt,
	lastUsedAt: null,
	householdScope: { kind: 'households' as const, householdIds: ['org_kitchen'] }
});

describe('local MCP key adapter', () => {
	it('loads remote summaries into Dexie without persisting a raw key', async () => {
		const { database, profileId } = await setupProfile();
		const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ keys: [publicRecord('key_one')] })
		);

		await expect(listMcpKeys(database, profileId, fetcher)).resolves.toMatchObject([
			{ id: 'key_one', label: 'Kitchen agent' }
		]);
		expect(fetcher).toHaveBeenCalledWith(
			'/api/auth-slots/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/mcp-keys',
			expect.objectContaining({ cache: 'no-store' })
		);
		const stored = await database.mcpKeySummaries.get('key_one');
		expect(stored).toMatchObject({ ownerUserId: 'user_alice', grantMode: 'selected' });
		expect(JSON.stringify(stored)).not.toContain('mk_');
		await expect(listCachedMcpKeys(database, profileId)).resolves.toMatchObject([
			{ id: 'key_one' }
		]);
	});

	it('persists create, reroll, and revoke summaries while returning secrets once', async () => {
		const { database, profileId } = await setupProfile();
		const responses = [
			{ key: 'mk_created', record: publicRecord('key_one') },
			{
				key: 'mk_rerolled',
				record: {
					...publicRecord('key_two'),
					createdAt: '2026-08-22T12:00:00.000Z'
				}
			},
			{ revoked: true }
		];
		const fetcher = vi.fn<typeof globalThis.fetch>(async () => Response.json(responses.shift()));

		await expect(
			createMcpKey(
				database,
				profileId,
				{
					label: 'Kitchen agent',
					preset: 'meal_planner',
					scopes: ['households:read', 'meals:read', 'meals:write'],
					householdScope: { kind: 'households', householdIds: ['org_kitchen'] }
				},
				fetcher
			)
		).resolves.toMatchObject({ key: 'mk_created', record: { id: 'key_one' } });
		await expect(rerollMcpKey(database, profileId, 'key_one', fetcher)).resolves.toMatchObject({
			key: 'mk_rerolled',
			record: { id: 'key_two' }
		});
		await expect(database.mcpKeySummaries.get('key_one')).resolves.toMatchObject({
			revokedAt: '2026-08-22T12:00:00.000Z'
		});
		await revokeMcpKey(database, profileId, 'key_two', fetcher);
		await expect(database.mcpKeySummaries.get('key_two')).resolves.toMatchObject({
			revokedAt: expect.any(String)
		});
		expect(JSON.stringify(await database.mcpKeySummaries.toArray())).not.toContain('mk_created');
		expect(JSON.stringify(await database.mcpKeySummaries.toArray())).not.toContain('mk_rerolled');
		expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
			'POST',
			'PUT',
			'DELETE'
		]);
	});
});
