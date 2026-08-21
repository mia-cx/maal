import { randomBytes, randomUUID } from 'node:crypto';
import { NotFoundException, WorkOS } from '@workos-inc/node';

const apiKey = process.env.WORKOS_API_KEY ?? '';
const clientId = process.env.WORKOS_CLIENT_ID ?? '';
const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? '';

if (!apiKey.startsWith('sk_test_'))
	throw new Error('Refusing to create proof users outside WorkOS staging');
if (!clientId || cookiePassword.length < 32)
	throw new Error('WorkOS proof configuration is incomplete');

const workos = new WorkOS(apiKey, { clientId });
const nonce = randomUUID();
const password = `Maal-proof-${randomBytes(18).toString('base64url')}!9`;
const createdUsers = [];
let evidence;
let cleanup;

try {
	const alice = await createProofUser('alice');
	const bob = await createProofUser('bob');

	const aliceSession = await authenticate(alice.email, password);
	const bobSession = await authenticate(bob.email, password);
	const aliceAuth = await load(aliceSession.sealedSession).authenticate();
	const bobAuth = await load(bobSession.sealedSession).authenticate();

	assert(aliceAuth.authenticated, 'Alice sealed session did not authenticate');
	assert(bobAuth.authenticated, 'Bob sealed session did not authenticate');
	assert(aliceAuth.user.id === alice.id, 'Alice sealed session has the wrong identity');
	assert(bobAuth.user.id === bob.id, 'Bob sealed session has the wrong identity');
	assert(
		aliceAuth.sessionId !== bobAuth.sessionId,
		'WorkOS returned the same session for both users'
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

	const aliceRefresh = await load(aliceSession.sealedSession).refresh();
	assert(aliceRefresh.authenticated, 'Alice session did not refresh');
	const bobAfterAliceRefresh = await load(bobSession.sealedSession).authenticate();
	assert(bobAfterAliceRefresh.authenticated, 'Alice refresh changed Bob session');
	assert(
		bobAfterAliceRefresh.sessionId === bobAuth.sessionId,
		'Alice refresh replaced Bob session'
	);

	await workos.userManagement.revokeSession({ sessionId: aliceRefresh.sessionId });
	const aliceAfterRevoke = await load(aliceRefresh.sealedSession).refresh();
	assert(!aliceAfterRevoke.authenticated, 'Alice refreshed after exact-session revocation');
	const bobAfterAliceRevoke = await load(bobSession.sealedSession).refresh();
	assert(bobAfterAliceRevoke.authenticated, 'Alice revocation changed Bob session');
	await workos.userManagement.revokeSession({ sessionId: bobAfterAliceRevoke.sessionId });

	evidence = {
		result: 'passed',
		aliceUserId: alice.id,
		bobUserId: bob.id,
		aliceSessionId: aliceAuth.sessionId,
		bobSessionId: bobAuth.sessionId,
		aliceCookieBytes: aliceBytes,
		bobCookieBytes: bobBytes,
		bobSurvivedAliceRefresh: true,
		bobSurvivedAliceRevocation: true
	};
} finally {
	cleanup = await deleteAndVerifyUsers(createdUsers);
}

if (!evidence) throw new Error('The WorkOS API proof did not produce evidence');
process.stdout.write(`${JSON.stringify({ ...evidence, cleanup }, null, 2)}\n`);

async function createProofUser(label) {
	const user = await workos.userManagement.createUser({
		email: `maal-auth-slot-${label}+${nonce}@example.test`,
		password,
		emailVerified: true,
		firstName: `${label}-${'x'.repeat(32)}`,
		lastName: `proof-${'y'.repeat(32)}`,
		metadata: {
			proof: 'retained-auth-slots',
			device: 'shared-kitchen-display',
			locale: 'en-NL'
		}
	});
	createdUsers.push(user);
	return user;
}

async function deleteAndVerifyUsers(users) {
	const failures = [];
	let verifiedDeleted = 0;
	for (const user of users) {
		try {
			await workos.userManagement.deleteUser(user.id);
			try {
				await workos.userManagement.getUser(user.id);
				throw new Error(`Disposable WorkOS user still resolves: ${user.id}`);
			} catch (error) {
				if (!(error instanceof NotFoundException)) throw error;
			}
			const matches = await workos.userManagement.listUsers({ email: user.email });
			assert(
				!matches.data.some(({ id }) => id === user.id),
				`Disposable WorkOS user remains listed: ${user.id}`
			);
			verifiedDeleted += 1;
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (failures.length > 0) throw new Error(`WorkOS cleanup failed: ${failures.join('; ')}`);
	return {
		attempted: users.length,
		verifiedDeleted,
		remainingDisposableUsers: users.length - verifiedDeleted,
		verifiedAtUtc: new Date().toISOString()
	};
}

async function authenticate(email, userPassword) {
	const response = await workos.userManagement.authenticateWithPassword({
		email,
		password: userPassword,
		session: { sealSession: true, cookiePassword }
	});
	assert(response.sealedSession, 'WorkOS did not seal the proof session');
	return response;
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
