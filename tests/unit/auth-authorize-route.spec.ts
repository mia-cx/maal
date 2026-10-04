import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	openAuthCompletion,
	openAuthFlow,
	sealAuthFlow,
	type AuthFlow
} from '$lib/server/auth-slots/flow.js';

const ALICE_SLOT = '00112233445566778899aabbccddeeff';
const BOB_SLOT = 'ffeeddccbbaa99887766554433221100';
const COOKIE_PASSWORD = 'a'.repeat(32);

const workos = vi.hoisted(() => ({
	authorizationUrl: vi.fn(
		({ state }: { readonly state: string }) =>
			`https://authkit.test/authorize?state=${encodeURIComponent(state)}`
	),
	openSlotIdentity: vi.fn()
}));

vi.mock('$lib/server/auth-slots', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/auth-slots')>()),
	authSlotAdapterFor: () => ({ authorizationUrl: workos.authorizationUrl }),
	readAuthSlotConfig: () => ({
		apiKey: 'test-key',
		clientId: 'client_test',
		cookiePassword: COOKIE_PASSWORD
	}),
	openSlotIdentity: workos.openSlotIdentity
}));

const { GET } = await import('../../src/routes/api/auth-slots/[slot]/authorize/+server.js');

describe('retained profile authorization HTTP seam', () => {
	beforeEach(() => {
		workos.authorizationUrl.mockClear();
		workos.openSlotIdentity.mockReset();
	});

	it('sends concurrent slots through one registered callback with independent opaque state', async () => {
		workos.openSlotIdentity.mockResolvedValue(null);
		const alice = eventFor(
			ALICE_SLOT,
			`https://maal.test/api/auth-slots/${ALICE_SLOT}/authorize?returnTo=/plan`
		);
		const bob = eventFor(
			BOB_SLOT,
			`https://maal.test/api/auth-slots/${BOB_SLOT}/authorize?returnTo=/settings/profile`
		);

		await expectRedirect(GET(alice.event), 'https://authkit.test/authorize');
		await expectRedirect(GET(bob.event), 'https://authkit.test/authorize');

		const [aliceRequest, bobRequest] = workos.authorizationUrl.mock.calls
			.slice(-2)
			.map(([input]) => input as { readonly redirectUri: string; readonly state: string });
		expect(aliceRequest.redirectUri).toBe('https://maal.test/api/auth/callback');
		expect(bobRequest.redirectUri).toBe(aliceRequest.redirectUri);
		expect(aliceRequest.state).not.toBe(bobRequest.state);

		const [aliceFlow, bobFlow] = await Promise.all([
			openAuthFlow(aliceRequest.state, COOKIE_PASSWORD),
			openAuthFlow(bobRequest.state, COOKIE_PASSWORD)
		]);
		expect(aliceFlow).toMatchObject({
			authSlotId: ALICE_SLOT,
			purpose: 'add-profile',
			expectedUserId: null,
			returnTo: '/plan'
		});
		expect(bobFlow).toMatchObject({
			authSlotId: BOB_SLOT,
			purpose: 'add-profile',
			expectedUserId: null,
			returnTo: '/settings/profile'
		});
		expect(aliceFlow?.nonce).not.toBe(bobFlow?.nonce);
		expect(aliceFlow).not.toHaveProperty('pinResetNonce');
		expect(bobFlow).not.toHaveProperty('pinResetNonce');
		expectMarker(alice.cookies.set, aliceFlow!);
		expectMarker(bob.cookies.set, bobFlow!);
	});

	it('binds reauthentication state to the selected slot user without exposing them in state', async () => {
		workos.openSlotIdentity.mockResolvedValue('user_alice');
		const request = eventFor(
			ALICE_SLOT,
			`https://maal.test/api/auth-slots/${ALICE_SLOT}/authorize?purpose=reauthenticate&returnTo=//evil.test&pinResetNonce=${BOB_SLOT}`
		);

		await expectRedirect(GET(request.event), 'https://authkit.test/authorize');

		const input = workos.authorizationUrl.mock.calls.at(-1)?.[0] as {
			readonly redirectUri: string;
			readonly state: string;
		};
		expect(input.state).not.toContain(ALICE_SLOT);
		expect(input.state).not.toContain('user_alice');
		await expect(openAuthFlow(input.state, COOKIE_PASSWORD)).resolves.toMatchObject({
			authSlotId: ALICE_SLOT,
			purpose: 'reauthenticate',
			expectedUserId: 'user_alice',
			returnTo: '/',
			pinResetNonce: BOB_SLOT
		});
		await expect(openAuthCompletion(input.state, COOKIE_PASSWORD)).resolves.toBeNull();
	});

	it.each(['', 'abc', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(33)])(
		'rejects invalid PIN reset nonce %j before creating an authorization flow',
		async (pinResetNonce) => {
			const request = eventFor(
				ALICE_SLOT,
				`https://maal.test/api/auth-slots/${ALICE_SLOT}/authorize?pinResetNonce=${pinResetNonce}`
			);
			await expect(GET(request.event)).rejects.toMatchObject({ status: 400 });
			expect(workos.openSlotIdentity).not.toHaveBeenCalled();
			expect(workos.authorizationUrl).not.toHaveBeenCalled();
			expect(request.cookies.set).not.toHaveBeenCalled();
		}
	);

	it.each(['', 'A'.repeat(32), null, 42])(
		'rejects an otherwise sealed flow with invalid PIN reset nonce %j',
		async (pinResetNonce) => {
			const issuedAt = Date.now() - 1_000;
			const state = await sealAuthFlow(
				{
					schemaVersion: 1,
					authSlotId: ALICE_SLOT,
					purpose: 'reauthenticate',
					expectedUserId: 'user_alice',
					returnTo: '/',
					nonce: BOB_SLOT,
					issuedAt: new Date(issuedAt).toISOString(),
					expiresAt: new Date(issuedAt + 600_000).toISOString(),
					pinResetNonce
				} as AuthFlow,
				COOKIE_PASSWORD
			);
			await expect(openAuthFlow(state, COOKIE_PASSWORD)).resolves.toBeNull();
		}
	);
});

function eventFor(slot: string, url: string) {
	const get = vi.fn(() => undefined);
	const set = vi.fn();
	return {
		cookies: { get, set },
		event: {
			params: { slot },
			url: new URL(url),
			cookies: { get, set },
			platform: { env: {} }
		} as never
	};
}

async function expectRedirect(request: unknown, locationPrefix: string) {
	try {
		await request;
		expect.fail('Expected a redirect');
	} catch (cause) {
		expect(cause).toMatchObject({ status: 303 });
		expect(String((cause as { location?: unknown }).location)).toMatch(
			new RegExp(`^${locationPrefix}`)
		);
	}
}

function expectMarker(set: ReturnType<typeof vi.fn>, flow: AuthFlow) {
	expect(set).toHaveBeenCalledWith(
		`__Secure-maal_auth_flow_${flow.nonce}`,
		'pending',
		expect.objectContaining({
			path: '/api/auth/callback',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 600
		})
	);
}
