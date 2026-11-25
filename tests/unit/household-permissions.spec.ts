import { describe, expect, test, vi } from 'vitest';

import { expandWorkOSPermissions } from '$lib/domain/household/permissions.js';
import { createWorkOSAuthSlotAdapter } from '$lib/server/auth-slots/adapter.js';

vi.mock('@workos-inc/node', () => ({
	WorkOS: class {
		userManagement = {
			listOrganizationMemberships: async () => ({
				autoPagination: async () => [
					{
						id: 'membership_alice',
						organizationId: 'org_family',
						organizationName: 'Family kitchen',
						role: { slug: 'member' },
						directoryManaged: false,
						createdAt: '2026-08-22T09:00:00.000Z'
					}
				]
			})
		};
		authorization = {
			getOrganizationRole: async () => ({
				permissions: ['household:meals:manage', 'check_ins:write']
			}),
			getEnvironmentRole: async () => ({ permissions: [] })
		};
	}
}));

const everyPermission = [
	'households:write',
	'recipes:read',
	'recipes:write',
	'meals:read',
	'meals:write'
];

describe('expandWorkOSPermissions', () => {
	test.each([
		[['households:write'], everyPermission],
		[['household:manage'], everyPermission],
		[['household:meals:attend'], ['meals:read']],
		[['household:meals:manage'], ['recipes:read', 'recipes:write', 'meals:read', 'meals:write']],
		[
			['meals:write', 'recipes:read'],
			['recipes:read', 'meals:write']
		],
		[
			['check_ins:write', 'food_profile:read', 'households:read', 'constructor', 'meals:read'],
			['meals:read']
		],
		[[], []]
	])('%j grants %j', (workosPermissions, expected) => {
		expect(expandWorkOSPermissions(workosPermissions)).toEqual(expected);
	});

	test('is idempotent, so re-expanding a stored projection changes nothing', () => {
		const expanded = expandWorkOSPermissions(['household:meals:manage', 'meals:read']);
		expect(expandWorkOSPermissions(expanded)).toEqual(expanded);
	});

	test('live WorkOS memberships carry the expanded permissions', async () => {
		const adapter = createWorkOSAuthSlotAdapter({
			apiKey: 'test-key-not-used',
			clientId: 'client_test',
			cookiePassword: 'a'.repeat(32)
		});

		const [membership] = await adapter.listActiveMemberships('user_alice');

		expect(membership?.permissions).toEqual([
			'recipes:read',
			'recipes:write',
			'meals:read',
			'meals:write'
		]);
	});
});
