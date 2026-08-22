import { Schema } from 'effect';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AuthSlotMetadata } from '$lib/auth-slots/index.js';

const SLOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const authenticate = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/auth-slots', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/auth-slots')>()),
	authSlotAdapterFor: () => ({ authenticate })
}));

const { GET } = await import('../../src/routes/api/auth-slots/[slot]/+server.js');

const eventFor = (sealedSession?: string) =>
	({
		params: { slot: SLOT },
		cookies: { get: vi.fn(() => sealedSession) },
		platform: { env: {} }
	}) as unknown as Parameters<typeof GET>[0];

beforeEach(() => authenticate.mockReset());

describe('selected auth-slot metadata route', () => {
	test('returns a versioned reauthentication projection without loading WorkOS when no cookie exists', async () => {
		const response = await GET(eventFor());
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(Schema.decodeUnknownSync(AuthSlotMetadata)(await response.json())).toEqual({
			schemaVersion: 1,
			authSlotId: SLOT,
			status: 'reauthRequired'
		});
		expect(authenticate).not.toHaveBeenCalled();
	});

	test('returns only safe display metadata for an authenticated selected cookie', async () => {
		authenticate.mockResolvedValue({
			authenticated: true,
			sessionId: 'session-secret',
			organizationId: 'org_private_projection',
			user: {
				id: 'user_alice',
				email: 'alice@example.test',
				firstName: 'Alice',
				lastName: 'de Vries',
				profilePictureUrl: null
			}
		});

		const response = await GET(eventFor('sealed-session-secret'));
		const raw = await response.json();
		expect(Schema.decodeUnknownSync(AuthSlotMetadata)(raw)).toMatchObject({
			schemaVersion: 1,
			authSlotId: SLOT,
			status: 'authenticated',
			workosUserId: 'user_alice',
			email: 'alice@example.test',
			firstName: 'Alice',
			lastName: 'de Vries'
		});
		expect(raw).not.toHaveProperty('sessionId');
		expect(raw).not.toHaveProperty('organizationId');
		expect(raw).not.toHaveProperty('user');
		expect(JSON.stringify(raw)).not.toContain('secret');
		expect(authenticate).toHaveBeenCalledWith('sealed-session-secret');
	});
});
