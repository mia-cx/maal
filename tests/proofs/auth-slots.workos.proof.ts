import {
	expect,
	test,
	type APIRequestContext,
	type BrowserContext,
	type Page
} from '@playwright/test';

const ALICE_SLOT = '00112233445566778899aabbccddeeff';
const BOB_SLOT = 'ffeeddccbbaa99887766554433221100';

const credentials = {
	alice: {
		email: process.env.AUTH_SLOT_PROOF_ALICE_EMAIL,
		password: process.env.AUTH_SLOT_PROOF_ALICE_PASSWORD
	},
	bob: {
		email: process.env.AUTH_SLOT_PROOF_BOB_EMAIL,
		password: process.env.AUTH_SLOT_PROOF_BOB_PASSWORD
	}
};

test.beforeAll(() => {
	const missing = [
		['AUTH_SLOT_PROOF_BASE_URL', process.env.AUTH_SLOT_PROOF_BASE_URL],
		['AUTH_SLOT_PROOF_ALICE_EMAIL', credentials.alice.email],
		['AUTH_SLOT_PROOF_ALICE_PASSWORD', credentials.alice.password],
		['AUTH_SLOT_PROOF_BOB_EMAIL', credentials.bob.email],
		['AUTH_SLOT_PROOF_BOB_PASSWORD', credentials.bob.password]
	]
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (missing.length > 0) throw new Error(`Missing live proof variables: ${missing.join(', ')}`);
});

test('Hosted AuthKit retains, refreshes, and revokes Alice and Bob independently', async ({
	context,
	page,
	request,
	baseURL
}) => {
	await addProfile(page, ALICE_SLOT, credentials.alice.email!, credentials.alice.password!);
	const alice = await status(request, baseURL!, ALICE_SLOT);

	await addProfile(page, BOB_SLOT, credentials.bob.email!, credentials.bob.password!);
	const bob = await status(request, baseURL!, BOB_SLOT);
	expect(alice.workosUserId).not.toBe(bob.workosUserId);

	const cookies = await context.cookies(baseURL);
	const aliceSession = sessionCookie(cookies, ALICE_SLOT);
	const bobSession = sessionCookie(cookies, BOB_SLOT);
	expect(completeCookieBytes(aliceSession)).toBeLessThan(4096);
	expect(completeCookieBytes(bobSession)).toBeLessThan(4096);
	expect(aliceSession.path).toBe(`/api/auth-slots/${ALICE_SLOT}/`);
	expect(bobSession.path).toBe(`/api/auth-slots/${BOB_SLOT}/`);
	expect(aliceSession.httpOnly).toBe(true);
	expect(bobSession.httpOnly).toBe(true);

	const refresh = await request.post(`${baseURL}/api/auth-slots/${ALICE_SLOT}/refresh`, {
		data: {}
	});
	expect(refresh.ok()).toBe(true);
	const bobAfterAliceRefresh = await status(request, baseURL!, BOB_SLOT);
	expect(bobAfterAliceRefresh.workosUserId).toBe(bob.workosUserId);

	const signOut = await request.post(`${baseURL}/api/auth-slots/${ALICE_SLOT}/sign-out`);
	expect(signOut.status()).toBe(204);
	expect((await status(request, baseURL!, ALICE_SLOT)).status).toBe('reauthRequired');
	expect((await status(request, baseURL!, BOB_SLOT)).workosUserId).toBe(bob.workosUserId);

	await addProfile(
		page,
		ALICE_SLOT,
		credentials.alice.email!,
		credentials.alice.password!,
		'reauthenticate'
	);
	expect((await status(request, baseURL!, ALICE_SLOT)).workosUserId).toBe(alice.workosUserId);

	const remove = await request.delete(`${baseURL}/api/auth-slots/${ALICE_SLOT}/`);
	expect(remove.status()).toBe(204);
	expect((await status(request, baseURL!, BOB_SLOT)).workosUserId).toBe(bob.workosUserId);
});

async function addProfile(
	page: Page,
	slotId: string,
	email: string,
	password: string,
	purpose = 'add-profile'
) {
	await page.goto(
		`/api/auth-slots/${slotId}/authorize?purpose=${purpose}&loginHint=${encodeURIComponent(email)}&returnTo=/`
	);

	const emailInput = page.getByLabel(/email/i).first();
	if (await emailInput.isVisible()) {
		await emailInput.fill(email);
		await page
			.getByRole('button', { name: /continue|sign in|log in/i })
			.first()
			.click();
	}

	const passwordInput = page.getByLabel(/password/i).first();
	await expect(passwordInput).toBeVisible();
	await passwordInput.fill(password);
	await page
		.getByRole('button', { name: /continue|sign in|log in/i })
		.first()
		.click();
	await page.waitForURL((url) => url.searchParams.get('authStatus') === 'authenticated');
}

async function status(request: APIRequestContext, baseURL: string, slotId: string) {
	const response = await request.get(`${baseURL}/api/auth-slots/${slotId}/`);
	expect(response.ok()).toBe(true);
	return (await response.json()) as { status: string; workosUserId?: string };
}

function sessionCookie(cookies: Awaited<ReturnType<BrowserContext['cookies']>>, slotId: string) {
	const cookie = cookies.find(({ name }) => name === `__Secure-maal_session_${slotId}`);
	expect(cookie).toBeDefined();
	return cookie!;
}

function completeCookieBytes(cookie: ReturnType<typeof sessionCookie>) {
	const value = [
		`${cookie.name}=${cookie.value}`,
		`Path=${cookie.path}`,
		'HttpOnly',
		'Secure',
		'SameSite=Lax',
		cookie.expires > 0 ? `Expires=${new Date(cookie.expires * 1000).toUTCString()}` : undefined
	]
		.filter(Boolean)
		.join('; ');
	return new TextEncoder().encode(value).byteLength;
}
