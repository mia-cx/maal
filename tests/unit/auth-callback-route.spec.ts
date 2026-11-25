import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	authCompletionCookieName,
	authFlowCookieName,
	AUTH_FLOW_MARKER_VALUE,
	openAuthCompletion,
	openAuthFlow,
	sealAuthCompletion,
	sealAuthFlow,
	type AuthFlow
} from '$lib/server/auth-slots';

const ALICE_SLOT = '00112233445566778899aabbccddeeff';
const BOB_SLOT = 'ffeeddccbbaa99887766554433221100';
const ALICE_NONCE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB_NONCE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const COOKIE_PASSWORD = 'a'.repeat(32);

const workos = vi.hoisted(() => ({
	exchangeCode: vi.fn(),
	revoke: vi.fn()
}));

vi.mock('$lib/server/auth-slots', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/auth-slots')>()),
	authSlotAdapterFor: () => ({ exchangeCode: workos.exchangeCode, revoke: workos.revoke }),
	readAuthSlotConfig: () => ({
		apiKey: 'test-key',
		clientId: 'client_test',
		cookiePassword: COOKIE_PASSWORD
	})
}));

const { GET } = await import('../../src/routes/api/auth/callback/+server.js');

describe('stable retained-profile callback HTTP seam', () => {
	beforeEach(() => {
		workos.exchangeCode.mockReset();
		workos.revoke.mockReset();
	});

	it('completes concurrent Alice and Bob flows without replacing either retained slot', async () => {
		const [aliceState, bobState] = await Promise.all([
			stateFor(ALICE_SLOT, ALICE_NONCE),
			stateFor(BOB_SLOT, BOB_NONCE)
		]);
		const jar = new Map<string, string>([
			[authFlowCookieName(ALICE_NONCE), AUTH_FLOW_MARKER_VALUE],
			[authFlowCookieName(BOB_NONCE), AUTH_FLOW_MARKER_VALUE]
		]);
		workos.exchangeCode
			.mockResolvedValueOnce(sessionFor('alice'))
			.mockResolvedValueOnce(sessionFor('bob'));

		const alice = eventFor(aliceState, 'code-alice', jar);
		await expectRedirect(GET(alice.event), `/?authSlot=${ALICE_SLOT}&authStatus=authenticated`);
		expect(jar.get(authFlowCookieName(BOB_NONCE))).toBe(AUTH_FLOW_MARKER_VALUE);

		const bob = eventFor(bobState, 'code-bob', jar);
		await expectRedirect(GET(bob.event), `/?authSlot=${BOB_SLOT}&authStatus=authenticated`);

		expectSessionCookies(alice.cookies.set, ALICE_SLOT);
		expectSessionCookies(bob.cookies.set, BOB_SLOT);
		const [aliceFlow, aliceProof, bobProof] = await Promise.all([
			openAuthFlow(aliceState, COOKIE_PASSWORD),
			openAuthCompletion(jar.get(authCompletionCookieName(ALICE_SLOT)), COOKIE_PASSWORD),
			openAuthCompletion(jar.get(authCompletionCookieName(BOB_SLOT)), COOKIE_PASSWORD)
		]);
		expect(aliceProof).toEqual({
			...aliceFlow,
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice'
		});
		expect(aliceProof).not.toHaveProperty('pinResetNonce');
		expect(bobProof).toMatchObject({ authSlotId: BOB_SLOT, expectedUserId: 'user_bob' });
		expect(alice.cookies.set).not.toHaveBeenCalledWith(
			expect.stringContaining(BOB_SLOT),
			expect.anything(),
			expect.anything()
		);
		expect(bob.cookies.set).not.toHaveBeenCalledWith(
			expect.stringContaining(ALICE_SLOT),
			expect.anything(),
			expect.anything()
		);
		expect(jar.has(authFlowCookieName(ALICE_NONCE))).toBe(false);
		expect(jar.has(authFlowCookieName(BOB_NONCE))).toBe(false);
	});

	it('rejects tampered, expired, and replayed state before another code exchange', async () => {
		const state = await stateFor(ALICE_SLOT, ALICE_NONCE);
		const marker = authFlowCookieName(ALICE_NONCE);
		const jar = new Map<string, string>([[marker, AUTH_FLOW_MARKER_VALUE]]);
		workos.exchangeCode.mockResolvedValue(sessionFor('alice'));

		const tampered = eventFor(`${state}tampered`, 'code-tampered', jar);
		await expectStatus(GET(tampered.event), 400);
		expect(tampered.cookies.set).not.toHaveBeenCalled();
		expect(workos.exchangeCode).not.toHaveBeenCalled();

		const expired = await stateFor(ALICE_SLOT, ALICE_NONCE, {
			issuedAt: '2026-08-21T11:00:00.000Z',
			expiresAt: '2026-08-21T11:10:00.000Z'
		});
		const expiredRequest = eventFor(expired, 'code-expired', jar);
		await expectStatus(GET(expiredRequest.event), 400);
		expect(expiredRequest.cookies.set).not.toHaveBeenCalled();
		expect(workos.exchangeCode).not.toHaveBeenCalled();

		const first = eventFor(state, 'code-alice', jar);
		await expectRedirect(GET(first.event), `/?authSlot=${ALICE_SLOT}&authStatus=authenticated`);
		expect(workos.exchangeCode).toHaveBeenCalledTimes(1);
		jar.delete(authCompletionCookieName(ALICE_SLOT));
		const replay = eventFor(state, 'code-alice', jar);
		await expectStatus(GET(replay.event), 400);
		expect(replay.cookies.set).not.toHaveBeenCalled();
		expect(jar.has(authCompletionCookieName(ALICE_SLOT))).toBe(false);
		expect(workos.exchangeCode).toHaveBeenCalledTimes(1);
	});

	it('binds fresh reauthentication proof to the matched owner, PIN reset nonce and original expiry', async () => {
		const state = await stateFor(ALICE_SLOT, ALICE_NONCE, {
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice',
			pinResetNonce: BOB_NONCE
		});
		const jar = new Map<string, string>([
			[authFlowCookieName(ALICE_NONCE), AUTH_FLOW_MARKER_VALUE]
		]);
		workos.exchangeCode.mockResolvedValue(sessionFor('alice'));

		const request = eventFor(state, 'code-alice', jar);
		await expectRedirect(GET(request.event), `/?authSlot=${ALICE_SLOT}&authStatus=authenticated`);
		const flow = await openAuthFlow(state, COOKIE_PASSWORD);
		const completion = jar.get(authCompletionCookieName(ALICE_SLOT));
		await expect(openAuthCompletion(completion, COOKIE_PASSWORD)).resolves.toEqual(flow);
		await expect(openAuthFlow(completion, COOKIE_PASSWORD)).resolves.toBeNull();
		await expect(openAuthCompletion(state, COOKIE_PASSWORD)).resolves.toBeNull();
		expect(workos.revoke).not.toHaveBeenCalled();
		expectSessionCookies(request.cookies.set, ALICE_SLOT);
	});

	it('rejects completion proof used as callback state even with a valid pending marker', async () => {
		const state = await stateFor(ALICE_SLOT, ALICE_NONCE, {
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice',
			pinResetNonce: BOB_NONCE
		});
		const flow = await openAuthFlow(state, COOKIE_PASSWORD);
		const completion = await sealAuthCompletion(flow!, COOKIE_PASSWORD);
		const jar = new Map<string, string>([
			[authFlowCookieName(ALICE_NONCE), AUTH_FLOW_MARKER_VALUE]
		]);
		const request = eventFor(completion, 'code-alice', jar);

		await expectStatus(GET(request.event), 400);
		expect(workos.exchangeCode).not.toHaveBeenCalled();
		expect(request.cookies.set).not.toHaveBeenCalled();
		expect(jar.get(authFlowCookieName(ALICE_NONCE))).toBe(AUTH_FLOW_MARKER_VALUE);
	});

	it('consumes a failed exchange marker without issuing proof or allowing a retry', async () => {
		const state = await stateFor(ALICE_SLOT, ALICE_NONCE);
		const jar = new Map<string, string>([
			[authFlowCookieName(ALICE_NONCE), AUTH_FLOW_MARKER_VALUE]
		]);
		workos.exchangeCode.mockRejectedValue(new Error('Invalid authorization code'));

		const request = eventFor(state, 'invalid-code', jar);
		expect((await GET(request.event)).status).toBe(503);
		expect(request.cookies.set).not.toHaveBeenCalled();
		expect(jar.has(authCompletionCookieName(ALICE_SLOT))).toBe(false);
		expect(jar.has(authFlowCookieName(ALICE_NONCE))).toBe(false);
		const replay = eventFor(state, 'invalid-code', jar);
		await expectStatus(GET(replay.event), 400);
		expect(replay.cookies.set).not.toHaveBeenCalled();
		expect(workos.exchangeCode).toHaveBeenCalledOnce();
	});

	it('revokes only a mismatched reauthentication session and writes no retained cookie', async () => {
		const state = await stateFor(ALICE_SLOT, ALICE_NONCE, {
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice'
		});
		const jar = new Map([
			[authFlowCookieName(ALICE_NONCE), AUTH_FLOW_MARKER_VALUE],
			[`__Secure-maal_session_${BOB_SLOT}`, 'bob-session']
		]);
		workos.exchangeCode.mockResolvedValue(sessionFor('bob'));

		const request = eventFor(state, 'code-wrong-user', jar);
		const response = await GET(request.event);

		expect(response.status).toBe(403);
		expect(workos.revoke).toHaveBeenCalledOnce();
		expect(workos.revoke).toHaveBeenCalledWith('session_bob');
		expect(request.cookies.set).not.toHaveBeenCalled();
		expect(jar.has(authCompletionCookieName(ALICE_SLOT))).toBe(false);
		expect(jar.get(`__Secure-maal_session_${BOB_SLOT}`)).toBe('bob-session');
	});
});

async function stateFor(authSlotId: string, nonce: string, overrides: Partial<AuthFlow> = {}) {
	const issuedAt = Date.now() - 1_000;
	return sealAuthFlow(
		{
			schemaVersion: 1,
			authSlotId,
			purpose: 'add-profile',
			expectedUserId: null,
			returnTo: '/',
			nonce,
			issuedAt: new Date(issuedAt).toISOString(),
			expiresAt: new Date(issuedAt + 600_000).toISOString(),
			...overrides
		} as AuthFlow,
		COOKIE_PASSWORD
	);
}

function sessionFor(label: 'alice' | 'bob') {
	return {
		authenticated: true as const,
		sealedSession: `sealed-${label}`,
		sessionId: `session_${label}`,
		organizationId: null,
		user: {
			id: `user_${label}`,
			email: `${label}@example.test`,
			firstName: label,
			lastName: null,
			profilePictureUrl: null
		}
	};
}

function eventFor(state: string, code: string, jar: Map<string, string>) {
	const get = vi.fn((name: string) => jar.get(name));
	const set = vi.fn((name: string, value: string) => jar.set(name, value));
	const remove = vi.fn((name: string) => jar.delete(name));
	return {
		cookies: { get, set, delete: remove },
		event: {
			params: {},
			url: new URL(
				`https://maal.test/api/auth/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`
			),
			request: new Request('https://maal.test/api/auth/callback', {
				headers: { 'user-agent': 'Maal route proof' }
			}),
			cookies: { get, set, delete: remove },
			platform: { env: {} },
			getClientAddress: () => '203.0.113.1'
		} as never
	};
}

async function expectRedirect(request: unknown, location: string) {
	try {
		await request;
		expect.fail('Expected a redirect');
	} catch (cause) {
		expect(cause).toMatchObject({ status: 303, location });
	}
}

async function expectStatus(request: unknown, status: number) {
	try {
		await request;
		expect.fail(`Expected HTTP ${status}`);
	} catch (cause) {
		expect(cause).toMatchObject({ status });
	}
}

function expectSessionCookies(set: ReturnType<typeof vi.fn>, slotId: string) {
	expect(set).toHaveBeenCalledWith(
		`__Secure-maal_session_${slotId}`,
		expect.stringMatching(/^sealed-/),
		expect.objectContaining({
			path: `/api/auth-slots/${slotId}/`,
			httpOnly: true,
			secure: true,
			sameSite: 'lax'
		})
	);
	expect(set).toHaveBeenCalledWith(
		`__Secure-maal_identity_${slotId}`,
		expect.any(String),
		expect.objectContaining({ path: `/api/auth-slots/${slotId}/` })
	);
	expect(set).toHaveBeenCalledWith(authCompletionCookieName(slotId), expect.any(String), {
		path: `/api/auth-slots/${slotId}/`,
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600
	});
}
