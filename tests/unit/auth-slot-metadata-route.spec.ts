import { Schema } from 'effect';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AuthSlotMetadata } from '$lib/auth-slots/index.js';
import {
	authCompletionCookieName,
	authCookieOptions,
	authIdentityCookieName,
	authSlotCookieName,
	openAuthCompletion,
	openAuthFlow,
	sealAuthCompletion,
	sealAuthFlow,
	type AuthFlow
} from '$lib/server/auth-slots';

const SLOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SLOT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PIN_RESET_NONCE = 'cccccccccccccccccccccccccccccccc';
const COOKIE_PASSWORD = 'a'.repeat(32);
const authenticate = vi.hoisted(() => vi.fn());
const listActiveMemberships = vi.hoisted(() => vi.fn());
const discoverActiveHouseholds = vi.hoisted(() => vi.fn());
const readAuthSlotConfig = vi.hoisted(() => vi.fn());
const revokeSelectedSession = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/auth-slots', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/auth-slots')>()),
	authSlotAdapterFor: () => ({ authenticate, listActiveMemberships }),
	discoverActiveHouseholds,
	readAuthSlotConfig,
	revokeSelectedSession
}));

const { GET, DELETE } = await import('../../src/routes/api/auth-slots/[slot]/+server.js');

const eventFor = (sealedSession?: string, completionProof?: string, query = '') => {
	const jar = new Map<string, string>();
	if (sealedSession) jar.set(authSlotCookieName(SLOT), sealedSession);
	if (completionProof !== undefined) jar.set(authCompletionCookieName(SLOT), completionProof);
	jar.set(authIdentityCookieName(SLOT), 'sealed-identity');
	jar.set(authSlotCookieName(OTHER_SLOT), 'other-session');
	jar.set(authIdentityCookieName(OTHER_SLOT), 'other-identity');
	return {
		params: { slot: SLOT },
		url: new URL(`https://maal.test/api/auth-slots/${SLOT}/${query}`),
		cookies: {
			get: vi.fn((name: string) => jar.get(name)),
			delete: vi.fn((name: string) => jar.delete(name))
		},
		platform: { env: { DB: {} } }
	} as unknown as Parameters<typeof GET>[0];
};

beforeEach(() => {
	authenticate.mockReset().mockResolvedValue({
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
	listActiveMemberships.mockReset().mockResolvedValue([]);
	discoverActiveHouseholds.mockReset().mockResolvedValue([]);
	readAuthSlotConfig.mockReset().mockImplementation(() => {
		throw new Error('No auth proof configuration available');
	});
	revokeSelectedSession.mockReset().mockResolvedValue(undefined);
});

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
		expect(readAuthSlotConfig).not.toHaveBeenCalled();
	});

	test('returns only safe display metadata for an authenticated selected cookie', async () => {
		const event = eventFor('sealed-session-secret');
		const response = await GET(event);
		const raw = (await response.json()) as Record<string, unknown>;
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
		expect(raw).not.toHaveProperty('freshAuthentication');
		expect(raw).not.toHaveProperty('pinResetNonce');
		expect(raw.households).toEqual([]);
		expect(JSON.stringify(raw)).not.toContain('secret');
		expect(authenticate).toHaveBeenCalledWith('sealed-session-secret');
		expect(listActiveMemberships).toHaveBeenCalledWith('user_alice');
		expect(discoverActiveHouseholds).toHaveBeenCalledWith(
			expect.objectContaining({ workosUserId: 'user_alice', liveMemberships: [] })
		);
		expect(readAuthSlotConfig).not.toHaveBeenCalled();
		expect(event.cookies.delete).not.toHaveBeenCalled();
	});

	test.each([undefined, PIN_RESET_NONCE])(
		'consumes valid fresh authentication proof exactly once with PIN reset nonce %j',
		async (pinResetNonce) => {
			readAuthSlotConfig.mockReturnValue({ cookiePassword: COOKIE_PASSWORD });
			const event = eventFor(
				'sealed-session-secret',
				await proofFor(pinResetNonce === undefined ? {} : { pinResetNonce })
			);

			const first = await GET(event);
			const raw = await first.json();
			expect(first.headers.get('cache-control')).toBe('private, no-store');
			expect(Schema.decodeUnknownSync(AuthSlotMetadata)(raw)).toMatchObject({
				status: 'authenticated',
				freshAuthentication: true,
				...(pinResetNonce === undefined ? {} : { pinResetNonce })
			});
			if (pinResetNonce === undefined) expect(raw).not.toHaveProperty('pinResetNonce');
			expect(event.cookies.delete).toHaveBeenCalledExactlyOnceWith(
				authCompletionCookieName(SLOT),
				authCookieOptions(SLOT)
			);
			expect(event.cookies.get(authSlotCookieName(SLOT))).toBe('sealed-session-secret');
			expect(readAuthSlotConfig).toHaveBeenCalledOnce();

			const second = await GET(event);
			const retained = await second.json();
			expect(retained).toMatchObject({ status: 'authenticated' });
			expect(retained).not.toHaveProperty('freshAuthentication');
			expect(retained).not.toHaveProperty('pinResetNonce');
			expect(event.cookies.delete).toHaveBeenCalledOnce();
			expect(readAuthSlotConfig).toHaveBeenCalledOnce();
			expect(authenticate).toHaveBeenCalledTimes(2);
		}
	);

	test.each([
		['invalid', {}, true],
		['expired', { issuedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-01T00:10:00.000Z' }],
		['wrong slot', { authSlotId: OTHER_SLOT }],
		['wrong user', { expectedUserId: 'user_bob' }],
		['missing owner', { purpose: 'add-profile', expectedUserId: null }]
	] as const)(
		'consumes but rejects %s completion proof',
		async (_label, overrides, tampered: boolean = false) => {
			readAuthSlotConfig.mockReturnValue({ cookiePassword: COOKIE_PASSWORD });
			const sealed = await proofFor({ ...overrides, pinResetNonce: PIN_RESET_NONCE });
			const event = eventFor('sealed-session-secret', tampered ? `${sealed}tampered` : sealed);
			const response = await GET(event);
			const raw = await response.json();
			expect(raw).toMatchObject({ status: 'authenticated' });
			expect(raw).not.toHaveProperty('freshAuthentication');
			expect(raw).not.toHaveProperty('pinResetNonce');
			expect(event.cookies.delete).toHaveBeenCalledExactlyOnceWith(
				authCompletionCookieName(SLOT),
				authCookieOptions(SLOT)
			);
			expect(event.cookies.get(authCompletionCookieName(SLOT))).toBeUndefined();
			expect(event.cookies.get(authSlotCookieName(SLOT))).toBe('sealed-session-secret');
		}
	);

	test('rejects pre-authentication state as completion proof despite matching slot, owner and PIN reset nonce', async () => {
		readAuthSlotConfig.mockReturnValue({ cookiePassword: COOKIE_PASSWORD });
		const flow = await openAuthCompletion(
			await proofFor({ pinResetNonce: PIN_RESET_NONCE }),
			COOKIE_PASSWORD
		);
		const state = await sealAuthFlow(flow!, COOKIE_PASSWORD);
		await expect(openAuthFlow(state, COOKIE_PASSWORD)).resolves.toMatchObject({
			authSlotId: SLOT,
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice',
			pinResetNonce: PIN_RESET_NONCE
		});
		const event = eventFor('sealed-session-secret', state);
		const response = await GET(event);
		const raw = await response.json();
		expect(raw).toMatchObject({ status: 'authenticated' });
		expect(raw).not.toHaveProperty('freshAuthentication');
		expect(raw).not.toHaveProperty('pinResetNonce');
		expect(event.cookies.delete).toHaveBeenCalledExactlyOnceWith(
			authCompletionCookieName(SLOT),
			authCookieOptions(SLOT)
		);
		expect(event.cookies.get(authCompletionCookieName(SLOT))).toBeUndefined();
	});

	test.each([undefined, 'stale-session'])(
		'does not trust proof without an authenticated session %j',
		async (session) => {
			authenticate.mockResolvedValue({ authenticated: false, reason: 'invalid_session_cookie' });
			const event = eventFor(session, await proofFor({ pinResetNonce: PIN_RESET_NONCE }));
			const response = await GET(event);
			const raw = await response.json();
			expect(raw).not.toMatchObject({ status: 'authenticated' });
			expect(raw).not.toHaveProperty('freshAuthentication');
			expect(raw).not.toHaveProperty('pinResetNonce');
			expect(readAuthSlotConfig).not.toHaveBeenCalled();
			expect(event.cookies.delete).not.toHaveBeenCalled();
		}
	);

	test('consumes an empty invalid proof without granting fresh authentication', async () => {
		readAuthSlotConfig.mockReturnValue({ cookiePassword: COOKIE_PASSWORD });
		const event = eventFor('sealed-session-secret', '');
		const raw = await (await GET(event)).json();
		expect(raw).toMatchObject({ status: 'authenticated' });
		expect(raw).not.toHaveProperty('freshAuthentication');
		expect(raw).not.toHaveProperty('pinResetNonce');
		expect(event.cookies.delete).toHaveBeenCalledExactlyOnceWith(
			authCompletionCookieName(SLOT),
			authCookieOptions(SLOT)
		);
	});
});

describe('selected auth-slot deletion route', () => {
	test.each(['', '?preserveIdentity=false', '?preserveIdentity=TRUE'])(
		'clears identity and completion proof on signout %j',
		async (query) => {
			const event = eventFor('sealed-session-secret', 'completion-proof', query);
			expect((await DELETE(event)).status).toBe(204);
			expect(revokeSelectedSession).toHaveBeenCalledExactlyOnceWith(event, SLOT);
			expect(event.cookies.delete).toHaveBeenCalledWith(
				authIdentityCookieName(SLOT),
				authCookieOptions(SLOT)
			);
			expect(event.cookies.delete).toHaveBeenCalledWith(
				authCompletionCookieName(SLOT),
				authCookieOptions(SLOT)
			);
			expect(event.cookies.get(authIdentityCookieName(SLOT))).toBeUndefined();
			expect(event.cookies.get(authCompletionCookieName(SLOT))).toBeUndefined();
			expect(event.cookies.get(authSlotCookieName(OTHER_SLOT))).toBe('other-session');
			expect(event.cookies.get(authIdentityCookieName(OTHER_SLOT))).toBe('other-identity');
		}
	);

	test('preserves only the identity binding when rejecting a slot for capacity', async () => {
		const event = eventFor('sealed-session-secret', 'completion-proof', '?preserveIdentity=true');
		expect((await DELETE(event)).status).toBe(204);
		expect(revokeSelectedSession).toHaveBeenCalledExactlyOnceWith(event, SLOT);
		expect(event.cookies.delete).toHaveBeenCalledExactlyOnceWith(
			authCompletionCookieName(SLOT),
			authCookieOptions(SLOT)
		);
		expect(event.cookies.get(authIdentityCookieName(SLOT))).toBe('sealed-identity');
		expect(event.cookies.get(authCompletionCookieName(SLOT))).toBeUndefined();
	});
});

async function proofFor(overrides: Partial<AuthFlow> = {}) {
	const issuedAt = Date.now() - 1_000;
	return sealAuthCompletion(
		{
			schemaVersion: 1,
			authSlotId: SLOT,
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice',
			returnTo: '/',
			nonce: OTHER_SLOT,
			issuedAt: new Date(issuedAt).toISOString(),
			expiresAt: new Date(issuedAt + 600_000).toISOString(),
			...overrides
		},
		COOKIE_PASSWORD
	);
}
