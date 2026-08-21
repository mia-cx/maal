import { randomBytes, randomUUID } from 'node:crypto';
import { release } from 'node:os';
import { chmod, writeFile } from 'node:fs/promises';
import { NotFoundException, WorkOS, type User } from '@workos-inc/node';
import {
	expect,
	test,
	type APIRequestContext,
	type BrowserContext,
	type Page
} from '@playwright/test';
import {
	inspectSessionSetCookie,
	requestCookieNames
} from '../../scripts/lib/auth-slot-proof-evidence.ts';

const ALICE_SLOT = '00112233445566778899aabbccddeeff';
const BOB_SLOT = 'ffeeddccbbaa99887766554433221100';
const apiKey = process.env.WORKOS_API_KEY ?? '';
const clientId = process.env.WORKOS_CLIENT_ID ?? '';
const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? '';

test.beforeAll(() => {
	const missing = [
		['AUTH_SLOT_PROOF_BASE_URL', process.env.AUTH_SLOT_PROOF_BASE_URL],
		['WORKOS_API_KEY', apiKey],
		['WORKOS_CLIENT_ID', clientId],
		['WORKOS_COOKIE_PASSWORD', cookiePassword]
	]
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (missing.length > 0) throw new Error(`Missing live proof variables: ${missing.join(', ')}`);
	if (!apiKey.startsWith('sk_test_')) {
		throw new Error('Refusing to create proof users outside WorkOS staging');
	}
	if (cookiePassword.length < 32) throw new Error('WORKOS_COOKIE_PASSWORD must be 32+ characters');
});

test('Hosted AuthKit retains, refreshes, and revokes Alice and Bob independently', async ({
	context,
	page,
	baseURL,
	browserName
}, testInfo) => {
	const workos = new WorkOS(apiKey, { clientId });
	const nonce = randomUUID();
	const password = `Maal-proof-${randomBytes(18).toString('base64url')}!9`;
	const users: User[] = [];
	let cleanup: CleanupEvidence | undefined;
	let evidence: Record<string, unknown> | undefined;

	try {
		const alice = await createProofUser(workos, users, 'alice', nonce, password);
		const bob = await createProofUser(workos, users, 'bob', nonce, password);

		const aliceLogin = await addProfile(page, ALICE_SLOT, alice.email, password);
		const aliceCookie = inspectSessionSetCookie(aliceLogin, ALICE_SLOT);
		const aliceSessionId = await sessionIdFromCookie(workos, aliceLogin, ALICE_SLOT);
		const aliceStatus = await status(context.request, baseURL!, ALICE_SLOT);

		const bobLogin = await addProfile(page, BOB_SLOT, bob.email, password);
		const bobCookie = inspectSessionSetCookie(bobLogin, BOB_SLOT);
		const bobSessionId = await sessionIdFromCookie(workos, bobLogin, BOB_SLOT);
		const bobStatus = await status(context.request, baseURL!, BOB_SLOT);
		expect(aliceStatus.workosUserId).not.toBe(bobStatus.workosUserId);
		expect((await status(context.request, baseURL!, ALICE_SLOT)).workosUserId).toBe(
			aliceStatus.workosUserId
		);

		const routing = await routingEvidence(context, page, baseURL!, ALICE_SLOT, BOB_SLOT);
		expect(routing.appAsset).not.toContain(aliceCookie.name);
		expect(routing.appAsset).not.toContain(bobCookie.name);
		expect(routing.aliceSlot).toContain(aliceCookie.name);
		expect(routing.aliceSlot).not.toContain(bobCookie.name);
		expect(routing.bobSlot).toContain(bobCookie.name);
		expect(routing.bobSlot).not.toContain(aliceCookie.name);

		const refresh = await context.request.post(`${baseURL}/api/auth-slots/${ALICE_SLOT}/refresh`, {
			data: {}
		});
		expect(refresh.ok()).toBe(true);
		const aliceRefreshCookie = inspectSessionSetCookie(await refresh.headersArray(), ALICE_SLOT);
		const bobAfterAliceRefresh = await status(context.request, baseURL!, BOB_SLOT);
		expect(bobAfterAliceRefresh.workosUserId).toBe(bobStatus.workosUserId);

		const signOut = await context.request.post(`${baseURL}/api/auth-slots/${ALICE_SLOT}/sign-out`);
		expect(signOut.status()).toBe(204);
		expect((await status(context.request, baseURL!, ALICE_SLOT)).status).toBe('reauthRequired');
		expect((await status(context.request, baseURL!, BOB_SLOT)).workosUserId).toBe(
			bobStatus.workosUserId
		);

		const aliceReauthentication = await addProfile(
			page,
			ALICE_SLOT,
			alice.email,
			password,
			'reauthenticate'
		);
		const aliceReauthenticationCookie = inspectSessionSetCookie(aliceReauthentication, ALICE_SLOT);
		expect((await status(context.request, baseURL!, ALICE_SLOT)).workosUserId).toBe(
			aliceStatus.workosUserId
		);

		const remove = await context.request.delete(`${baseURL}/api/auth-slots/${ALICE_SLOT}/`);
		expect(remove.status()).toBe(204);
		expect((await status(context.request, baseURL!, BOB_SLOT)).workosUserId).toBe(
			bobStatus.workosUserId
		);

		const runtime = await browserEvidence(page, context, browserName);
		evidence = {
			schemaVersion: 1,
			kind: 'supplemental-playwright',
			releaseEvidence: false,
			project: testInfo.project.name,
			gitCommit: process.env.AUTH_SLOT_PROOF_GIT_COMMIT ?? 'not-recorded',
			stagingDeploymentLabel:
				process.env.AUTH_SLOT_PROOF_DEPLOYMENT_LABEL ?? new URL(baseURL!).host,
			runAtUtc: new Date().toISOString(),
			device: runtime.device,
			browser: runtime.browser,
			identities: {
				aliceWorkosUserId: aliceStatus.workosUserId,
				bobWorkosUserId: bobStatus.workosUserId,
				aliceSessionId,
				bobSessionId
			},
			cookies: {
				aliceInitial: aliceCookie,
				bobInitial: bobCookie,
				aliceRefresh: aliceRefreshCookie,
				aliceReauthentication: aliceReauthenticationCookie
			},
			requestCookieNames: routing,
			checks: {
				distinctIdentities: true,
				aliceSurvivedBobLogin: true,
				bobSurvivedAliceRefresh: true,
				bobSurvivedAliceRevocation: true,
				aliceReauthenticationBoundIdentity: true,
				bobSurvivedAliceRemoval: true
			},
			d1Opened: observedD1State()
		};
	} finally {
		cleanup = await deleteAndVerifyUsers(workos, users);
	}

	expect(cleanup.remainingDisposableUsers).toBe(0);
	if (!evidence) throw new Error('The route proof did not produce evidence');
	const output = testInfo.outputPath('auth-slot-evidence.json');
	await writeFile(output, `${JSON.stringify({ ...evidence, cleanup }, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600
	});
	await chmod(output, 0o600);
	await testInfo.attach('sanitized-auth-slot-evidence', {
		path: output,
		contentType: 'application/json'
	});
});

async function addProfile(
	page: Page,
	slotId: string,
	email: string,
	password: string,
	purpose = 'add-profile'
) {
	const callbackResponse = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === `/api/auth-slots/${slotId}/callback` && response.status() === 303;
	});

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
	return (await callbackResponse).headersArray();
}

async function status(request: APIRequestContext, baseURL: string, slotId: string) {
	const response = await request.get(`${baseURL}/api/auth-slots/${slotId}/`);
	expect(response.ok()).toBe(true);
	return (await response.json()) as { status: string; workosUserId?: string };
}

async function createProofUser(
	workos: WorkOS,
	users: User[],
	label: string,
	nonce: string,
	password: string
) {
	const user = await workos.userManagement.createUser({
		email: `maal-auth-slot-${label}+${nonce}@example.test`,
		password,
		emailVerified: true,
		firstName: `${label}-${'x'.repeat(32)}`,
		lastName: `proof-${'y'.repeat(32)}`,
		metadata: { proof: 'retained-auth-slots', issue: '70', nonce }
	});
	users.push(user);
	return user;
}

async function sessionIdFromCookie(
	workos: WorkOS,
	headers: readonly { readonly name: string; readonly value: string }[],
	slotId: string
) {
	const name = `__Secure-maal_session_${slotId}`;
	const line = headers
		.filter(({ name: headerName }) => headerName.toLowerCase() === 'set-cookie')
		.map(({ value }) => value)
		.find((value) => value.startsWith(`${name}=`));
	if (!line) throw new Error(`The callback did not set ${name}`);
	const pair = line.slice(0, line.indexOf(';'));
	const sealedSession = pair.slice(pair.indexOf('=') + 1);
	const result = await workos.userManagement
		.loadSealedSession({ sessionData: sealedSession, cookiePassword })
		.authenticate();
	if (!result.authenticated) throw new Error(`WorkOS could not authenticate ${name}`);
	return result.sessionId;
}

async function routingEvidence(
	context: BrowserContext,
	page: Page,
	baseURL: string,
	aliceSlot: string,
	bobSlot: string
) {
	await page.goto(baseURL);
	const assetPath = await page
		.locator('script[src], link[rel="stylesheet"][href]')
		.first()
		.evaluate((element) => element.getAttribute('src') ?? element.getAttribute('href'));
	if (!assetPath) throw new Error('The staging page did not expose an app asset');
	const assetUrl = new URL(assetPath, baseURL);
	assetUrl.searchParams.set('auth-slot-proof', randomUUID());

	return {
		appAsset: await requestNamesForNavigation(context, assetUrl.toString()),
		aliceSlot: await requestNamesForNavigation(context, `${baseURL}/api/auth-slots/${aliceSlot}/`),
		bobSlot: await requestNamesForNavigation(context, `${baseURL}/api/auth-slots/${bobSlot}/`)
	};
}

async function requestNamesForNavigation(context: BrowserContext, url: string) {
	const observer = await context.newPage();
	try {
		const observed = observer.waitForRequest((request) => request.url() === url);
		await observer.goto(url);
		const headers = await (await observed).allHeaders();
		return requestCookieNames(headers.cookie);
	} finally {
		await observer.close();
	}
}

async function browserEvidence(page: Page, context: BrowserContext, browserName: string) {
	const reported = await page.evaluate(() => ({
		userAgent: navigator.userAgent,
		platform: navigator.platform
	}));
	return {
		device: {
			hardwareModel: process.env.AUTH_SLOT_PROOF_HARDWARE_MODEL ?? 'Playwright host',
			osName: process.env.AUTH_SLOT_PROOF_OS_NAME ?? `${process.platform} (${reported.platform})`,
			osVersion: process.env.AUTH_SLOT_PROOF_OS_VERSION ?? release()
		},
		browser: {
			name: browserName,
			version: context.browser()?.version() ?? 'external browser',
			userAgent: reported.userAgent
		}
	};
}

async function deleteAndVerifyUsers(workos: WorkOS, users: readonly User[]) {
	const deleted = new Set<string>();
	const failures: string[] = [];
	for (const user of users) {
		try {
			await workos.userManagement.deleteUser(user.id);
			await assertUserAbsent(workos, user.id, user.email);
			deleted.add(user.id);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (failures.length > 0) throw new Error(`WorkOS cleanup failed: ${failures.join('; ')}`);
	return {
		aliceDeleted: users.length >= 1 && deleted.has(users[0].id),
		bobDeleted: users.length >= 2 && deleted.has(users[1].id),
		remainingDisposableUsers: users.filter(({ id }) => !deleted.has(id)).length,
		verifiedAtUtc: new Date().toISOString()
	};
}

async function assertUserAbsent(workos: WorkOS, userId: string, email: string) {
	try {
		await workos.userManagement.getUser(userId);
		throw new Error(`Disposable WorkOS user still resolves: ${userId}`);
	} catch (error) {
		if (!(error instanceof NotFoundException)) throw error;
	}
	const matches = await workos.userManagement.listUsers({ email });
	if (matches.data.some(({ id }) => id === userId)) {
		throw new Error(`Disposable WorkOS user remains in the staging user list: ${userId}`);
	}
}

function observedD1State() {
	const value = process.env.AUTH_SLOT_PROOF_D1_OPENED;
	if (value === 'true') return true;
	if (value === 'false') return false;
	return 'not-observed';
}

interface CleanupEvidence {
	readonly aliceDeleted: boolean;
	readonly bobDeleted: boolean;
	readonly remainingDisposableUsers: number;
	readonly verifiedAtUtc: string;
}
