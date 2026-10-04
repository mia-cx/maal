import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, readFile, unlink, writeFile } from 'node:fs/promises';
import { stdin } from 'node:process';
import { NotFoundException, WorkOS } from '@workos-inc/node';
import {
	NATIVE_AUTH_SLOT_TARGETS,
	createNativeEvidenceTemplate,
	inspectSessionSetCookie,
	validateNativeEvidence
} from './lib/auth-slot-proof-evidence.ts';

const [command, ...args] = process.argv.slice(2);

switch (command) {
	case 'init':
		await init(args);
		break;
	case 'inspect-cookie':
		await inspectCookie(args);
		break;
	case 'fixtures-create':
		await createFixtures(args);
		break;
	case 'fixtures-cleanup':
		await cleanupFixtures(args);
		break;
	case 'validate':
		await validate(args, false);
		break;
	case 'validate-matrix':
		await validate(args, true);
		break;
	default:
		usage();
}

async function init([target, output]) {
	assert(NATIVE_AUTH_SLOT_TARGETS.includes(target), `Unknown native target: ${target ?? ''}`);
	assert(output, 'init requires an output path');
	await writeFile(output, `${JSON.stringify(createNativeEvidenceTemplate(target), null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600
	});
	await chmod(output, 0o600);
	process.stdout.write(`Created private evidence template: ${output}\n`);
}

async function inspectCookie([slotId]) {
	assert(
		/^[a-f0-9]{32}$/.test(slotId ?? ''),
		'inspect-cookie requires a 32-character auth-slot ID'
	);
	const rawLine = await readStdin();
	const evidence = inspectSessionSetCookie([{ name: 'set-cookie', value: rawLine.trim() }], slotId);
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function createFixtures([output]) {
	assert(output, 'fixtures-create requires a private output path');
	const workos = proofWorkOS();
	const nonce = randomUUID();
	const password = `Maal-proof-${randomBytes(18).toString('base64url')}!9`;
	const users = [];
	try {
		for (const label of ['alice', 'bob']) {
			const user = await workos.userManagement.createUser({
				email: `maal-auth-slot-${label}+${nonce}@example.test`,
				password,
				emailVerified: true,
				firstName: `${label}-${'x'.repeat(32)}`,
				lastName: `proof-${'y'.repeat(32)}`,
				metadata: { proof: 'retained-auth-slots', issue: '70', nonce }
			});
			users.push({ label, id: user.id, email: user.email, password });
		}
		await writeFile(
			output,
			`${JSON.stringify({ schemaVersion: 1, environment: 'WorkOS staging', nonce, users }, null, 2)}\n`,
			{ encoding: 'utf8', flag: 'wx', mode: 0o600 }
		);
		await chmod(output, 0o600);
		process.stdout.write(
			`Created two disposable WorkOS staging users in private file: ${output}\n`
		);
	} catch (error) {
		await deleteAndVerify(workos, users).catch(() => undefined);
		throw error;
	}
}

async function cleanupFixtures([input]) {
	assert(input, 'fixtures-cleanup requires the private fixture path');
	const fixtures = JSON.parse(await readFile(input, 'utf8'));
	validateFixtures(fixtures);
	const result = await deleteAndVerify(proofWorkOS(), fixtures.users);
	await unlink(input);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function validate(paths, requireMatrix) {
	assert(paths.length > 0, 'validate requires at least one evidence path');
	const targets = new Set();
	for (const path of paths) {
		const evidence = JSON.parse(await readFile(path, 'utf8'));
		validateNativeEvidence(evidence);
		targets.add(evidence.target);
		process.stdout.write(`Validated ${evidence.target}: ${path}\n`);
	}
	if (requireMatrix) {
		for (const target of NATIVE_AUTH_SLOT_TARGETS) {
			assert(targets.has(target), `Native matrix is missing ${target}`);
		}
		assert(
			targets.size === NATIVE_AUTH_SLOT_TARGETS.length,
			'Native matrix has duplicate or unknown targets'
		);
		process.stdout.write('Validated the complete native auth-slot matrix.\n');
	}
}

async function readStdin() {
	let value = '';
	stdin.setEncoding('utf8');
	for await (const chunk of stdin) value += chunk;
	assert(value.trim().length > 0, 'inspect-cookie requires one Set-Cookie line on stdin');
	return value;
}

function usage() {
	throw new Error(
		[
			'Usage:',
			'  pnpm proof:auth-slots:evidence init <native-target> <private-output.json>',
			'  pnpm proof:auth-slots:evidence inspect-cookie <slot-id> < private-set-cookie.txt',
			'  pnpm proof:auth-slots:evidence fixtures-create <private-fixtures.json>',
			'  pnpm proof:auth-slots:evidence fixtures-cleanup <private-fixtures.json>',
			'  pnpm proof:auth-slots:evidence validate <evidence.json> [...]',
			'  pnpm proof:auth-slots:evidence validate-matrix <macos.json> <ios.json> <android.json>',
			`Native targets: ${NATIVE_AUTH_SLOT_TARGETS.join(', ')}`
		].join('\n')
	);
}

function proofWorkOS() {
	const apiKey = process.env.WORKOS_API_KEY ?? '';
	const clientId = process.env.WORKOS_CLIENT_ID ?? '';
	assert(apiKey.startsWith('sk_test_'), 'Refusing to manage proof users outside WorkOS staging');
	assert(clientId, 'WORKOS_CLIENT_ID is required');
	return new WorkOS(apiKey, { clientId });
}

function validateFixtures(value) {
	assert(value?.schemaVersion === 1, 'Fixture file has the wrong schema version');
	assert(value?.environment === 'WorkOS staging', 'Fixture file is not marked for WorkOS staging');
	assert(
		Array.isArray(value?.users) && value.users.length === 2,
		'Fixture file must contain Alice and Bob'
	);
	for (const [index, label] of ['alice', 'bob'].entries()) {
		const user = value.users[index];
		assert(user?.label === label, `Fixture ${index + 1} must be ${label}`);
		assert(
			typeof user.id === 'string' && user.id.startsWith('user_'),
			`${label} user ID is invalid`
		);
		assert(
			typeof user.email === 'string' && user.email.includes(value.nonce),
			`${label} email is invalid`
		);
		assert(
			typeof user.password === 'string' && user.password.length >= 20,
			`${label} password is invalid`
		);
	}
}

async function deleteAndVerify(workos, users) {
	const failures = [];
	let verifiedDeleted = 0;
	for (const user of users) {
		try {
			await workos.userManagement.deleteUser(user.id);
			await waitForUserAbsence(workos, user);
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

async function waitForUserAbsence(workos, user) {
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const resolves = await workos.userManagement
			.getUser(user.id)
			.then(() => true)
			.catch((error) => {
				if (error instanceof NotFoundException) return false;
				throw error;
			});
		const matches = await workos.userManagement.listUsers({ email: user.email });
		const listed = matches.data.some(({ id }) => id === user.id);
		if (!resolves && !listed) return;
		await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
	}
	throw new Error(`Disposable WorkOS user still resolves or remains listed: ${user.id}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
