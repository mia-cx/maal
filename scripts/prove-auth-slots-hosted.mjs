import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, devices, firefox, webkit } from '@playwright/test';
import { WorkOS } from '@workos-inc/node';

const apiKey = process.env.WORKOS_API_KEY ?? '';
const clientId = process.env.WORKOS_CLIENT_ID ?? '';
const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? '';
const redirectUri =
	process.env.AUTH_SLOT_PROOF_REDIRECT_URI ?? 'https://staging.maal.mia.cx/auth/callback';
const browserName = process.env.AUTH_SLOT_PROOF_BROWSER ?? 'chromium';
const browserType = { chromium, firefox, webkit, 'ios-webkit': webkit }[browserName];

if (!apiKey.startsWith('sk_test_'))
	throw new Error('Refusing to create proof users outside WorkOS staging');
if (!clientId || cookiePassword.length < 32)
	throw new Error('WorkOS proof configuration is incomplete');
if (!browserType) throw new Error(`Unsupported proof browser: ${browserName}`);

const workos = new WorkOS(apiKey, { clientId });
const nonce = randomUUID();
const password = `Maal-proof-${randomBytes(18).toString('base64url')}!9`;
const createdUserIds = [];
const browser = await browserType.launch();

try {
	const alice = await createProofUser('alice');
	const bob = await createProofUser('bob');
	const context = await browser.newContext(
		browserName === 'ios-webkit' ? devices['iPhone 15'] : undefined
	);
	const page = await context.newPage();
	await page.route(`${new URL(redirectUri).origin}/**`, (route) => route.abort());

	const aliceCode = await hostedCode(page, alice.email, password);
	const aliceSession = await exchange(aliceCode);
	const bobCode = await hostedCode(page, bob.email, password);
	const bobSession = await exchange(bobCode);

	const aliceAuth = await load(aliceSession.sealedSession).authenticate();
	const bobAuth = await load(bobSession.sealedSession).authenticate();
	assert(aliceAuth.authenticated, 'Alice session was lost while adding Bob');
	assert(bobAuth.authenticated, 'Bob session did not authenticate');
	assert(aliceAuth.user.id === alice.id, 'Alice sealed session has the wrong identity');
	assert(bobAuth.user.id === bob.id, 'Bob sealed session has the wrong identity');
	assert(
		aliceAuth.sessionId !== bobAuth.sessionId,
		'Hosted AuthKit returned one session for both users'
	);

	const aliceBytes = completeCookieBytes(
		'00112233445566778899aabbccddeeff',
		aliceSession.sealedSession
	);
	const bobBytes = completeCookieBytes(
		'ffeeddccbbaa99887766554433221100',
		bobSession.sealedSession
	);
	assert(aliceBytes < 4096, `Alice cookie is ${aliceBytes} bytes`);
	assert(bobBytes < 4096, `Bob cookie is ${bobBytes} bytes`);

	await workos.userManagement.revokeSession({ sessionId: aliceAuth.sessionId });
	const bobAfterAliceRevoke = await load(bobSession.sealedSession).refresh();
	assert(
		bobAfterAliceRevoke.authenticated,
		'Revoking Alice changed Bob after Hosted AuthKit login'
	);
	await workos.userManagement.revokeSession({ sessionId: bobAfterAliceRevoke.sessionId });

	process.stdout.write(
		`${JSON.stringify(
			{
				result: 'passed',
				loginSurface: 'Hosted AuthKit',
				browser: browserName,
				aliceUserId: alice.id,
				bobUserId: bob.id,
				aliceSessionId: aliceAuth.sessionId,
				bobSessionId: bobAuth.sessionId,
				aliceCookieBytes: aliceBytes,
				bobCookieBytes: bobBytes,
				aliceSurvivedBobLogin: true,
				bobSurvivedAliceRevocation: true
			},
			null,
			2
		)}\n`
	);
} finally {
	await browser.close();
	for (const userId of createdUserIds) {
		await workos.userManagement.deleteUser(userId).catch(() => undefined);
	}
}

async function hostedCode(page, email, userPassword) {
	const state = randomUUID();
	const authorizationUrl = workos.userManagement.getAuthorizationUrl({
		provider: 'authkit',
		clientId,
		redirectUri,
		state,
		prompt: 'login',
		maxAge: 0,
		loginHint: email,
		screenHint: 'sign-in'
	});

	await page.goto(authorizationUrl);
	const emailInput = page.locator('input[type="email"], input[name="email"]').first();
	if (await emailInput.isVisible()) {
		await emailInput.fill(email);
		await page.locator('button[type="submit"]').click();
	}

	const passwordInput = page.locator('input[type="password"]').first();
	await passwordInput.waitFor({ state: 'visible' });
	await passwordInput.fill(userPassword);
	const [callbackRequest] = await Promise.all([
		page.waitForRequest((request) => request.url().startsWith(redirectUri)),
		page.getByRole('button', { name: /^sign in$/i }).click()
	]);
	const callbackUrl = new URL(callbackRequest.url());
	assert(
		callbackUrl.searchParams.get('state') === state,
		'Hosted AuthKit returned the wrong state'
	);
	const code = callbackUrl.searchParams.get('code');
	assert(code, 'Hosted AuthKit did not return an authorization code');
	return code;
}

async function exchange(code) {
	const response = await workos.userManagement.authenticateWithCode({
		code,
		session: { sealSession: true, cookiePassword }
	});
	assert(response.sealedSession, 'WorkOS did not seal the Hosted AuthKit session');
	return response;
}

async function createProofUser(label) {
	const user = await workos.userManagement.createUser({
		email: `maal-auth-slot-${label}+${nonce}@example.test`,
		password,
		emailVerified: true,
		firstName: `${label}-${'x'.repeat(32)}`,
		lastName: `proof-${'y'.repeat(32)}`,
		metadata: { proof: 'retained-auth-slots', device: 'shared-kitchen-display' }
	});
	createdUserIds.push(user.id);
	return user;
}

function load(sealedSession) {
	return workos.userManagement.loadSealedSession({ sessionData: sealedSession, cookiePassword });
}

function completeCookieBytes(slotId, sealedSession) {
	const line = [
		`__Secure-maal_session_${slotId}=${sealedSession}`,
		`Path=/api/auth-slots/${slotId}/`,
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
		`Max-Age=${365 * 24 * 60 * 60}`
	].join('; ');
	return new TextEncoder().encode(line).byteLength;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
