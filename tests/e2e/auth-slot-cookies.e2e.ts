import { expect, test } from '@playwright/test';

const ALICE_SLOT = '00112233445566778899aabbccddeeff';
const BOB_SLOT = 'ffeeddccbbaa99887766554433221100';
const ORIGIN = 'https://maal.test';

test('the browser selects one HTTP-only session by slot path', async ({ context, page }) => {
	await context.addCookies([
		retainedCookie(ALICE_SLOT, 'alice-session'),
		retainedCookie(BOB_SLOT, 'bob-session')
	]);

	const cookieHeaders = new Map<string, string>();
	await context.route(`${ORIGIN}/**`, async (route) => {
		cookieHeaders.set(
			new URL(route.request().url()).pathname,
			route.request().headers()['cookie'] ?? ''
		);
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<!doctype html><html><body>auth slot proof</body></html>'
		});
	});

	await page.goto(`${ORIGIN}/assets/app.js`);
	expect(cookieHeaders.get('/assets/app.js')).toBe('');

	await page.goto(`${ORIGIN}/api/auth-slots/${ALICE_SLOT}/`);
	expect(cookieHeaders.get(`/api/auth-slots/${ALICE_SLOT}/`)).toContain(ALICE_SLOT);
	expect(cookieHeaders.get(`/api/auth-slots/${ALICE_SLOT}/`)).not.toContain(BOB_SLOT);
	expect(await page.evaluate(() => document.cookie)).toBe('');

	await page.goto(`${ORIGIN}/api/auth-slots/${BOB_SLOT}/refresh`);
	expect(cookieHeaders.get(`/api/auth-slots/${BOB_SLOT}/refresh`)).toContain(BOB_SLOT);
	expect(cookieHeaders.get(`/api/auth-slots/${BOB_SLOT}/refresh`)).not.toContain(ALICE_SLOT);
});

test('concurrent flow markers reach only the one stable callback', async ({ context, page }) => {
	const aliceNonce = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const bobNonce = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
	await context.addCookies([
		retainedCookie(ALICE_SLOT, 'alice-session'),
		retainedCookie(BOB_SLOT, 'bob-session'),
		flowMarker(aliceNonce),
		flowMarker(bobNonce)
	]);

	let callbackCookies = '';
	await context.route(`${ORIGIN}/**`, async (route) => {
		if (new URL(route.request().url()).pathname === '/api/auth/callback') {
			callbackCookies = route.request().headers()['cookie'] ?? '';
		}
		await route.fulfill({ status: 400, body: 'proof response' });
	});

	await page.goto(`${ORIGIN}/api/auth/callback?state=opaque&code=one-use`);
	expect(callbackCookies).toContain(`__Secure-maal_auth_flow_${aliceNonce}`);
	expect(callbackCookies).toContain(`__Secure-maal_auth_flow_${bobNonce}`);
	expect(callbackCookies).not.toContain(`__Secure-maal_session_${ALICE_SLOT}`);
	expect(callbackCookies).not.toContain(`__Secure-maal_session_${BOB_SLOT}`);
	expect(await page.evaluate(() => document.cookie)).toBe('');
});

function retainedCookie(slotId: string, value: string) {
	return {
		name: `__Secure-maal_session_${slotId}`,
		value,
		domain: 'maal.test',
		path: `/api/auth-slots/${slotId}/`,
		httpOnly: true,
		secure: true,
		sameSite: 'Lax' as const
	};
}

function flowMarker(nonce: string) {
	return {
		name: `__Secure-maal_auth_flow_${nonce}`,
		value: 'pending',
		domain: 'maal.test',
		path: '/api/auth/callback',
		httpOnly: true,
		secure: true,
		sameSite: 'Lax' as const
	};
}
