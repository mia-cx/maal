export const AUTH_SLOT_PROOF_SCHEMA_VERSION = 1 as const;
export const NATIVE_AUTH_SLOT_TARGETS = [
	'native-macos-safari',
	'native-ios-safari',
	'native-android-chrome'
] as const;

export type NativeAuthSlotTarget = (typeof NATIVE_AUTH_SLOT_TARGETS)[number];

export interface CookieEvidence {
	readonly name: string;
	readonly bytes: number;
	readonly path: string;
	readonly secure: true;
	readonly httpOnly: true;
	readonly sameSite: 'Lax';
	readonly hostOnly: true;
}

export interface NativeAuthSlotEvidence {
	readonly schemaVersion: typeof AUTH_SLOT_PROOF_SCHEMA_VERSION;
	readonly kind: 'native-device';
	readonly target: NativeAuthSlotTarget;
	readonly result: 'passed';
	readonly gitCommit: string;
	readonly stagingDeploymentLabel: string;
	readonly runAtUtc: string;
	readonly device: {
		readonly hardwareModel: string;
		readonly osName: string;
		readonly osVersion: string;
	};
	readonly browser: {
		readonly name: string;
		readonly version: string;
		readonly userAgent: string;
	};
	readonly identities: {
		readonly aliceWorkosUserId: string;
		readonly bobWorkosUserId: string;
		readonly aliceSessionId: string;
		readonly bobSessionId: string;
	};
	readonly cookies: {
		readonly alice: CookieEvidence;
		readonly bob: CookieEvidence;
	};
	readonly requestCookieNames: {
		readonly appAsset: readonly string[];
		readonly aliceSlot: readonly string[];
		readonly bobSlot: readonly string[];
	};
	readonly checks: {
		readonly distinctIdentities: true;
		readonly aliceSurvivedBobLogin: true;
		readonly bobSurvivedAliceRefresh: true;
		readonly bobSurvivedAliceRevocation: true;
		readonly aliceReauthenticationBoundIdentity: true;
		readonly bobSurvivedAliceRemoval: true;
	};
	readonly d1Opened: boolean;
	readonly cleanup: {
		readonly aliceDeleted: true;
		readonly bobDeleted: true;
		readonly remainingDisposableUsers: 0;
		readonly verifiedAtUtc: string;
	};
}

const FORBIDDEN_KEYS = new Set([
	'accessToken',
	'authorizationCode',
	'cookieHeader',
	'cookieValue',
	'password',
	'rawHeader',
	'refreshToken',
	'sealedSession'
]);

export function inspectSessionSetCookie(
	headers: readonly { readonly name: string; readonly value: string }[],
	slotId: string
): CookieEvidence {
	const expectedName = `__Secure-maal_session_${slotId}`;
	const line = headers
		.filter(({ name }) => name.toLowerCase() === 'set-cookie')
		.map(({ value }) => value)
		.find((value) => cookiePairName(value) === expectedName);

	assert(line, `The callback did not set ${expectedName}`);
	const segments = line.split(';').map((segment) => segment.trim());
	const attributes = new Map<string, string | true>();
	for (const segment of segments.slice(1)) {
		const separator = segment.indexOf('=');
		if (separator === -1) attributes.set(segment.toLowerCase(), true);
		else {
			attributes.set(
				segment.slice(0, separator).trim().toLowerCase(),
				segment.slice(separator + 1).trim()
			);
		}
	}

	const path = attributes.get('path');
	assert(path === `/api/auth-slots/${slotId}/`, `${expectedName} has the wrong Path`);
	assert(attributes.get('secure') === true, `${expectedName} is missing Secure`);
	assert(attributes.get('httponly') === true, `${expectedName} is missing HttpOnly`);
	assert(attributes.get('samesite') === 'Lax', `${expectedName} is missing SameSite=Lax`);
	assert(!attributes.has('domain'), `${expectedName} must remain host-only`);

	const bytes = new TextEncoder().encode(line).byteLength;
	assert(bytes < 4096, `${expectedName} is ${bytes} bytes`);

	return {
		name: expectedName,
		bytes,
		path,
		secure: true,
		httpOnly: true,
		sameSite: 'Lax',
		hostOnly: true
	};
}

export function requestCookieNames(header: string | null | undefined) {
	if (!header) return [];
	return header
		.split(';')
		.map((pair) => pair.slice(0, pair.indexOf('=')).trim())
		.filter(Boolean)
		.sort();
}

export function createNativeEvidenceTemplate(target: NativeAuthSlotTarget): NativeAuthSlotEvidence {
	const slotPath = '<exact slot path>';
	const cookie: CookieEvidence = {
		name: '<cookie name>',
		bytes: 0,
		path: slotPath,
		secure: true,
		httpOnly: true,
		sameSite: 'Lax' as const,
		hostOnly: true
	};

	return {
		schemaVersion: AUTH_SLOT_PROOF_SCHEMA_VERSION,
		kind: 'native-device',
		target,
		result: 'passed',
		gitCommit: '<40-character commit SHA>',
		stagingDeploymentLabel: '<non-secret deployment label>',
		runAtUtc: '<ISO-8601 UTC timestamp>',
		device: {
			hardwareModel: '<hardware model>',
			osName: '<OS name>',
			osVersion: '<OS version>'
		},
		browser: {
			name: '<browser name>',
			version: '<exact browser version>',
			userAgent: '<browser-reported user agent>'
		},
		identities: {
			aliceWorkosUserId: '<WorkOS user ID>',
			bobWorkosUserId: '<WorkOS user ID>',
			aliceSessionId: '<WorkOS session ID>',
			bobSessionId: '<WorkOS session ID>'
		},
		cookies: { alice: { ...cookie }, bob: { ...cookie } },
		requestCookieNames: { appAsset: [], aliceSlot: [], bobSlot: [] },
		checks: {
			distinctIdentities: true,
			aliceSurvivedBobLogin: true,
			bobSurvivedAliceRefresh: true,
			bobSurvivedAliceRevocation: true,
			aliceReauthenticationBoundIdentity: true,
			bobSurvivedAliceRemoval: true
		},
		d1Opened: false,
		cleanup: {
			aliceDeleted: true,
			bobDeleted: true,
			remainingDisposableUsers: 0,
			verifiedAtUtc: '<ISO-8601 UTC timestamp>'
		}
	};
}

export function validateNativeEvidence(value: unknown): asserts value is NativeAuthSlotEvidence {
	assertObject(value, 'evidence');
	rejectSecrets(value);
	assertKeys(value, 'evidence', [
		'schemaVersion',
		'kind',
		'target',
		'result',
		'gitCommit',
		'stagingDeploymentLabel',
		'runAtUtc',
		'device',
		'browser',
		'identities',
		'cookies',
		'requestCookieNames',
		'checks',
		'd1Opened',
		'cleanup'
	]);
	assert(value.schemaVersion === 1, 'schemaVersion must be 1');
	assert(value.kind === 'native-device', 'kind must be native-device');
	assert(
		NATIVE_AUTH_SLOT_TARGETS.includes(value.target as NativeAuthSlotTarget),
		'target must name a required native browser'
	);
	assert(value.result === 'passed', 'result must be passed');
	assertString(value.gitCommit, 'gitCommit', /^[a-f0-9]{40}$/);
	assertString(value.stagingDeploymentLabel, 'stagingDeploymentLabel');
	assertUtc(value.runAtUtc, 'runAtUtc');

	assertObject(value.device, 'device');
	assertKeys(value.device, 'device', ['hardwareModel', 'osName', 'osVersion']);
	assertString(value.device.hardwareModel, 'device.hardwareModel');
	assertString(value.device.osName, 'device.osName');
	assertString(value.device.osVersion, 'device.osVersion');
	assertObject(value.browser, 'browser');
	assertKeys(value.browser, 'browser', ['name', 'version', 'userAgent']);
	assertString(value.browser.name, 'browser.name');
	assertString(value.browser.version, 'browser.version');
	assertString(value.browser.userAgent, 'browser.userAgent');

	assertObject(value.identities, 'identities');
	assertKeys(value.identities, 'identities', [
		'aliceWorkosUserId',
		'bobWorkosUserId',
		'aliceSessionId',
		'bobSessionId'
	]);
	for (const key of [
		'aliceWorkosUserId',
		'bobWorkosUserId',
		'aliceSessionId',
		'bobSessionId'
	] as const) {
		assertString(value.identities[key], `identities.${key}`, /^(user|session)_[A-Za-z0-9]+$/);
	}
	assert(
		value.identities.aliceWorkosUserId !== value.identities.bobWorkosUserId,
		'Alice and Bob must have distinct WorkOS users'
	);
	assert(
		value.identities.aliceSessionId !== value.identities.bobSessionId,
		'Alice and Bob must have distinct WorkOS sessions'
	);

	assertObject(value.cookies, 'cookies');
	assertKeys(value.cookies, 'cookies', ['alice', 'bob']);
	validateCookieEvidence(value.cookies.alice, 'cookies.alice');
	validateCookieEvidence(value.cookies.bob, 'cookies.bob');
	assert(
		value.cookies.alice.name !== value.cookies.bob.name,
		'Alice and Bob must use distinct cookies'
	);
	assertObject(value.requestCookieNames, 'requestCookieNames');
	assertKeys(value.requestCookieNames, 'requestCookieNames', ['appAsset', 'aliceSlot', 'bobSlot']);
	const appAssetCookieNames = value.requestCookieNames.appAsset;
	const aliceSlotCookieNames = value.requestCookieNames.aliceSlot;
	const bobSlotCookieNames = value.requestCookieNames.bobSlot;
	assertStringArray(appAssetCookieNames, 'requestCookieNames.appAsset');
	assertStringArray(aliceSlotCookieNames, 'requestCookieNames.aliceSlot');
	assertStringArray(bobSlotCookieNames, 'requestCookieNames.bobSlot');
	assert(
		!appAssetCookieNames.includes(value.cookies.alice.name) &&
			!appAssetCookieNames.includes(value.cookies.bob.name),
		'app assets must receive no retained session cookie'
	);
	assert(
		aliceSlotCookieNames.includes(value.cookies.alice.name),
		'Alice route must receive the Alice session cookie'
	);
	assert(
		!aliceSlotCookieNames.includes(value.cookies.bob.name),
		'Alice route received Bob session cookie'
	);
	assert(
		bobSlotCookieNames.includes(value.cookies.bob.name),
		'Bob route must receive the Bob session cookie'
	);
	assert(
		!bobSlotCookieNames.includes(value.cookies.alice.name),
		'Bob route received Alice session cookie'
	);

	assertObject(value.checks, 'checks');
	assertKeys(value.checks, 'checks', [
		'distinctIdentities',
		'aliceSurvivedBobLogin',
		'bobSurvivedAliceRefresh',
		'bobSurvivedAliceRevocation',
		'aliceReauthenticationBoundIdentity',
		'bobSurvivedAliceRemoval'
	]);
	for (const check of [
		'distinctIdentities',
		'aliceSurvivedBobLogin',
		'bobSurvivedAliceRefresh',
		'bobSurvivedAliceRevocation',
		'aliceReauthenticationBoundIdentity',
		'bobSurvivedAliceRemoval'
	] as const) {
		assert(value.checks[check] === true, `checks.${check} must pass`);
	}
	assert(typeof value.d1Opened === 'boolean', 'd1Opened must be measured');
	assertObject(value.cleanup, 'cleanup');
	assertKeys(value.cleanup, 'cleanup', [
		'aliceDeleted',
		'bobDeleted',
		'remainingDisposableUsers',
		'verifiedAtUtc'
	]);
	assert(value.cleanup.aliceDeleted === true, 'cleanup must verify Alice deletion');
	assert(value.cleanup.bobDeleted === true, 'cleanup must verify Bob deletion');
	assert(
		value.cleanup.remainingDisposableUsers === 0,
		'cleanup must verify zero disposable users remain'
	);
	assertUtc(value.cleanup.verifiedAtUtc, 'cleanup.verifiedAtUtc');
}

function validateCookieEvidence(value: unknown, label: string): asserts value is CookieEvidence {
	assertObject(value, label);
	assertKeys(value, label, ['name', 'bytes', 'path', 'secure', 'httpOnly', 'sameSite', 'hostOnly']);
	assertString(value.name, `${label}.name`, /^__Secure-maal_session_[a-f0-9]{32}$/);
	assert(typeof value.bytes === 'number', `${label}.bytes must be a number`);
	assert(
		Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes < 4096,
		`${label}.bytes is invalid`
	);
	assertString(value.path, `${label}.path`, /^\/api\/auth-slots\/[a-f0-9]{32}\/$/);
	assert(value.secure === true, `${label}.secure must be true`);
	assert(value.httpOnly === true, `${label}.httpOnly must be true`);
	assert(value.sameSite === 'Lax', `${label}.sameSite must be Lax`);
	assert(value.hostOnly === true, `${label}.hostOnly must be true`);
	const slotId = value.name.slice('__Secure-maal_session_'.length);
	assert(
		value.path === `/api/auth-slots/${slotId}/`,
		`${label} name and Path select different slots`
	);
}

function rejectSecrets(value: unknown, path = 'evidence') {
	if (!value || typeof value !== 'object') return;
	for (const [key, nested] of Object.entries(value)) {
		assert(!FORBIDDEN_KEYS.has(key), `${path}.${key} is forbidden in sanitized evidence`);
		rejectSecrets(nested, `${path}.${key}`);
	}
}

function cookiePairName(line: string) {
	const separator = line.indexOf('=');
	return separator === -1 ? '' : line.slice(0, separator).trim();
}

function assertString(value: unknown, label: string, pattern?: RegExp): asserts value is string {
	assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
	assert(!value.startsWith('<'), `${label} still contains a template placeholder`);
	if (pattern) assert(pattern.test(value), `${label} has the wrong format`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
	assert(Array.isArray(value), `${label} must be an array`);
	for (const item of value) assertString(item, `${label} item`, /^[A-Za-z0-9_.-]+$/);
}

function assertKeys(value: Record<string, unknown>, label: string, expected: readonly string[]) {
	const extras = Object.keys(value).filter((key) => !expected.includes(key));
	assert(extras.length === 0, `${label} has unsupported fields: ${extras.join(', ')}`);
	const missing = expected.filter((key) => !(key in value));
	assert(missing.length === 0, `${label} is missing fields: ${missing.join(', ')}`);
}

function assertUtc(value: unknown, label: string): asserts value is string {
	assertString(value, label);
	assert(
		value.endsWith('Z') && !Number.isNaN(Date.parse(value)),
		`${label} must be an ISO-8601 UTC timestamp`
	);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
	assert(
		Boolean(value) && typeof value === 'object' && !Array.isArray(value),
		`${label} must be an object`
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
