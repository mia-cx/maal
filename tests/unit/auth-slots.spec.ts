import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
	assertAuthSlotCapacity,
	assertReauthenticatedUser,
	AuthSlotCapacityExceeded,
	AuthSlotIdentityMismatch,
	AuthSlotProjection,
	createAuthSlotId,
	MAX_AUTHENTICATED_SLOTS,
	type AuthSlotId
} from '$lib/auth-slots';
import {
	assertAuthSlotCookieFits,
	AUTH_CALLBACK_PATH,
	authCookieOptions,
	authFlowCookieName,
	authFlowCookieOptions,
	authSlotCookieName,
	authSlotPath,
	AuthSlotCookieTooLarge,
	callbackUrl,
	createWorkOSAuthSlotAdapter,
	expectedUserForFlow,
	openAuthFlow,
	openSlotIdentity,
	safeReturnTo,
	sealAuthFlow,
	sealSlotIdentity,
	serializedCookieBytes
} from '$lib/server/auth-slots';

const ALICE_SLOT = '00112233445566778899aabbccddeeff' as AuthSlotId;

describe('auth-slot contracts', () => {
	it('creates a 128-bit opaque slot identifier', () => {
		const id = createAuthSlotId((bytes) => bytes.fill(0xab));
		expect(id).toBe('abababababababababababababababab');
	});

	it('allows eight retained sessions and rejects the ninth', () => {
		const profiles = Array.from({ length: MAX_AUTHENTICATED_SLOTS }, (_, index) => ({
			authSlotId: index.toString(16).padStart(32, '0') as AuthSlotId,
			status: 'authenticated' as const
		}));

		expect(() => assertAuthSlotCapacity(profiles, profiles[0].authSlotId)).not.toThrow();
		expect(() => assertAuthSlotCapacity(profiles)).toThrow(AuthSlotCapacityExceeded);
		expect(() =>
			assertAuthSlotCapacity([
				...profiles.slice(0, -1),
				{ ...profiles.at(-1)!, status: 'reauthRequired' }
			])
		).not.toThrow();
	});

	it('requires a reauthentication callback to return the same WorkOS user', () => {
		expect(() => assertReauthenticatedUser('user_alice', 'user_alice')).not.toThrow();
		expect(() => assertReauthenticatedUser('user_alice', 'user_bob')).toThrow(
			AuthSlotIdentityMismatch
		);
	});

	it('decodes a credential-free local projection', () => {
		const decoded = Schema.decodeUnknownSync(AuthSlotProjection)({
			schemaVersion: 1,
			profileId: 'profile-alice',
			authSlotId: ALICE_SLOT,
			workosUserId: 'user_alice',
			status: 'authenticated',
			email: 'alice@example.test',
			firstName: 'Alice',
			lastName: null,
			profilePictureUrl: null,
			lastVerifiedAt: '2026-08-21T12:00:00Z',
			accessToken: 'must-not-survive',
			refreshToken: 'must-not-survive',
			sealedSession: 'must-not-survive'
		});

		expect(decoded).not.toHaveProperty('accessToken');
		expect(decoded).not.toHaveProperty('refreshToken');
		expect(decoded).not.toHaveProperty('sealedSession');
	});
});

describe('auth-slot cookies', () => {
	it('uses one exact path and secure HTTP-only attributes per slot', () => {
		expect(authSlotPath(ALICE_SLOT)).toBe(`/api/auth-slots/${ALICE_SLOT}/`);
		expect(authSlotCookieName(ALICE_SLOT)).toBe(`__Secure-maal_session_${ALICE_SLOT}`);
		expect(authCookieOptions(ALICE_SLOT)).toMatchObject({
			path: `/api/auth-slots/${ALICE_SLOT}/`,
			httpOnly: true,
			secure: true,
			sameSite: 'lax'
		});
	});

	it('uses an independent one-use marker on the stable callback path', () => {
		const nonce = 'abcdefabcdefabcdefabcdefabcdefab';
		expect(authFlowCookieName(nonce)).toBe(`__Secure-maal_auth_flow_${nonce}`);
		expect(authFlowCookieOptions()).toMatchObject({
			path: AUTH_CALLBACK_PATH,
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 600
		});
	});

	it('rejects a complete Set-Cookie line at the browser limit', () => {
		expect(assertAuthSlotCookieFits(ALICE_SLOT, 'sealed-session')).toBeGreaterThan(0);
		expect(() => assertAuthSlotCookieFits(ALICE_SLOT, 'x'.repeat(4096))).toThrow(
			AuthSlotCookieTooLarge
		);
		expect(
			serializedCookieBytes(
				authSlotCookieName(ALICE_SLOT),
				'sealed-session',
				authCookieOptions(ALICE_SLOT)
			)
		).toBeLessThan(4096);
	});

	it('binds PIN reauthentication to the original user without exposing a credential', async () => {
		const binding = await sealSlotIdentity('user_alice', 'a'.repeat(32));
		expect(await openSlotIdentity(binding, 'a'.repeat(32))).toBe('user_alice');
		expect(await openSlotIdentity(`${binding}tampered`, 'a'.repeat(32))).toBeNull();
	});
});

describe('Hosted AuthKit contract', () => {
	it('forces an active login for every added profile', () => {
		const adapter = createWorkOSAuthSlotAdapter({
			apiKey: 'test-key-not-used',
			clientId: 'client_test',
			cookiePassword: 'a'.repeat(32)
		});
		const url = new URL(
			adapter.authorizationUrl({
				redirectUri: 'https://maal.test/api/auth/callback',
				state: 'state',
				loginHint: 'bob@example.test'
			})
		);

		expect(url.searchParams.get('provider')).toBe('authkit');
		expect(url.searchParams.get('prompt')).toBe('login');
		expect(url.searchParams.get('max_age')).toBe('0');
		expect(url.searchParams.get('login_hint')).toBe('bob@example.test');
	});

	it('uses one registered callback URI and encrypts every flow binding into expiring state', async () => {
		const flow = {
			schemaVersion: 1 as const,
			authSlotId: ALICE_SLOT,
			purpose: 'reauthenticate' as const,
			expectedUserId: 'user_alice',
			returnTo: '/på/profile',
			nonce: '0123456789abcdef0123456789abcdef',
			issuedAt: '2026-08-21T12:00:00.000Z',
			expiresAt: '2026-08-21T12:10:00.000Z'
		};
		const state = await sealAuthFlow(flow, 'a'.repeat(32), (bytes) => bytes.fill(0xab));

		expect(AUTH_CALLBACK_PATH).toBe('/api/auth/callback');
		expect(callbackUrl('https://maal.test/ignored')).toBe('https://maal.test/api/auth/callback');
		expect(state).not.toContain(ALICE_SLOT);
		expect(state).not.toContain('user_alice');
		expect(state).not.toContain(encodeURIComponent(flow.returnTo));
		await expect(
			openAuthFlow(state, 'a'.repeat(32), new Date('2026-08-21T12:09:59.999Z'))
		).resolves.toEqual(flow);
		await expect(
			openAuthFlow(`${state}tampered`, 'a'.repeat(32), new Date('2026-08-21T12:05:00.000Z'))
		).resolves.toBeNull();
		await expect(
			openAuthFlow(state, 'a'.repeat(32), new Date('2026-08-21T12:10:00.000Z'))
		).resolves.toBeNull();
		await expect(
			openAuthFlow(state, 'b'.repeat(32), new Date('2026-08-21T12:05:00.000Z'))
		).resolves.toBeNull();
		expect(safeReturnTo('//evil.example/path')).toBe('/');
		expect(safeReturnTo('/profiles')).toBe('/profiles');
	});

	it('never reuses a bound slot for another add-profile flow', () => {
		expect(expectedUserForFlow('reauthenticate', 'user_alice')).toBe('user_alice');
		expect(() => expectedUserForFlow('add-profile', 'user_alice')).toThrowError(
			expect.objectContaining({ _tag: 'AuthSlotAlreadyBound' })
		);
		expect(() => expectedUserForFlow('reauthenticate', null)).toThrowError(
			expect.objectContaining({ _tag: 'AuthSlotBindingMissing' })
		);
	});
});
