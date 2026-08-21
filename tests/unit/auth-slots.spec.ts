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
	authCookieOptions,
	authSlotCookieName,
	authSlotPath,
	AuthSlotCookieTooLarge,
	createWorkOSAuthSlotAdapter,
	decodeAuthFlow,
	encodeAuthFlow,
	expectedUserForFlow,
	openSlotIdentity,
	safeReturnTo,
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
				redirectUri: 'https://maal.test/api/auth-slots/slot/callback',
				state: 'state',
				loginHint: 'bob@example.test'
			})
		);

		expect(url.searchParams.get('provider')).toBe('authkit');
		expect(url.searchParams.get('prompt')).toBe('login');
		expect(url.searchParams.get('max_age')).toBe('0');
		expect(url.searchParams.get('login_hint')).toBe('bob@example.test');
	});

	it('round-trips Unicode flow state and rejects unsafe return paths', () => {
		const flow = {
			state: 'state',
			purpose: 'reauthenticate' as const,
			expectedUserId: 'user_alice',
			returnTo: '/på/profile',
			createdAt: '2026-08-21T12:00:00Z'
		};
		expect(decodeAuthFlow(encodeAuthFlow(flow))).toEqual(flow);
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
