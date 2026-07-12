import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	resolveHouseholdId,
	resolveScopedHouseholdId,
	requireScope,
	type McpContext
} from './context';
import type { McpKeyRecord } from '$lib/server/auth/mcp-keys';

const mocks = vi.hoisted(() => ({
	listUserHouseholds: vi.fn(),
	userHasHouseholdPermission: vi.fn(),
	scopeAllowsHousehold: vi.fn()
}));

vi.mock('$lib/server/auth/household', () => ({
	listUserHouseholds: mocks.listUserHouseholds,
	userHasHouseholdPermission: mocks.userHasHouseholdPermission
}));

vi.mock('$lib/server/auth/mcp-keys', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/auth/mcp-keys')>();
	return { ...actual, scopeAllowsHousehold: mocks.scopeAllowsHousehold };
});

const key = (overrides: Partial<McpKeyRecord> = {}): McpKeyRecord => ({
	id: 'key_1',
	userId: 'user_1',
	householdScope: { kind: 'all' },
	scopes: ['meals:read', 'meals:write'],
	label: 'Test key',
	createdAt: '2026-01-01T00:00:00.000Z',
	...overrides
});

const db = {} as McpContext['db'];

const context = (record = key()): McpContext => ({
	platform: undefined,
	key: record,
	db
});

beforeEach(() => {
	mocks.listUserHouseholds.mockReset();
	mocks.userHasHouseholdPermission.mockReset();
	mocks.scopeAllowsHousehold.mockReset();
	mocks.listUserHouseholds.mockResolvedValue([]);
	mocks.scopeAllowsHousehold.mockResolvedValue(true);
	mocks.userHasHouseholdPermission.mockResolvedValue(true);
});

describe('MCP context household resolution', () => {
	it('uses a single scoped household without requiring an argument', async () => {
		await expect(
			resolveScopedHouseholdId(
				context(key({ householdScope: { kind: 'households', householdIds: ['hh_1'] } })),
				{},
				'meals:read'
			)
		).resolves.toBe('hh_1');
	});

	it('requires householdId when an all-households key can access multiple households', async () => {
		mocks.listUserHouseholds.mockResolvedValue([{ id: 'hh_1' }, { id: 'hh_2' }]);

		await expect(resolveScopedHouseholdId(context(), {}, 'meals:read')).rejects.toMatchObject({
			code: 'household_required'
		});
	});

	it('uses the only accessible household for all-households keys', async () => {
		mocks.listUserHouseholds.mockResolvedValue([{ id: 'hh_1' }]);

		await expect(resolveScopedHouseholdId(context(), {}, 'meals:read')).resolves.toBe('hh_1');
	});

	it('rejects households outside key scope', async () => {
		mocks.scopeAllowsHousehold.mockResolvedValue(false);

		await expect(
			resolveScopedHouseholdId(context(), { householdId: 'hh_forbidden' }, 'meals:read')
		).rejects.toMatchObject({ code: 'household_forbidden' });
	});

	it('rejects missing API scopes', () => {
		expect(() => requireScope(key({ scopes: [] }), 'meals:read')).toThrow(
			expect.objectContaining({ code: 'insufficient_scope' })
		);
	});

	it('rejects missing household role permission', async () => {
		mocks.userHasHouseholdPermission.mockResolvedValue(false);

		await expect(
			resolveHouseholdId(context(), { householdId: 'hh_1' }, 'meals:read', 'meals:read')
		).rejects.toMatchObject({ code: 'insufficient_role_permission' });
	});
});
