export const AUTH_SLOT_PROOF_SCHEMA_VERSION = 3 as const;
export const NATIVE_AUTH_SLOT_TARGETS = [
	'native-macos-safari',
	'native-ios-safari',
	'native-android-chrome'
] as const;

export type NativeAuthSlotTarget = (typeof NATIVE_AUTH_SLOT_TARGETS)[number];

/** The two sealed cookies the callback sets per slot: the WorkOS session and the slot's identity. */
export type AuthSlotCookieKind = 'session' | 'identity';

const NATIVE_CHECKS = [
	'stableRegisteredCallback',
	'opaqueOneUseFlowState',
	'distinctIdentities',
	'aliceSurvivedBobLogin',
	'bobSurvivedAliceRefresh',
	'bobSurvivedAliceRevocation',
	'aliceReauthenticationBoundIdentity',
	'bobSurvivedAliceRemoval'
] as const;

type NativeCheck = (typeof NATIVE_CHECKS)[number];

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
	/** Sealed WorkOS session cookies, `__Secure-maal_session_<slot>`. */
	readonly cookies: {
		readonly aliceInitial: CookieEvidence;
		readonly bobInitial: CookieEvidence;
		readonly aliceRefresh: CookieEvidence;
		readonly aliceReauthentication: CookieEvidence;
	};
	/** Sealed identity cookies, `__Secure-maal_identity_<slot>`. Only the callback sets them. */
	readonly identityCookies: {
		readonly aliceInitial: CookieEvidence;
		readonly bobInitial: CookieEvidence;
		readonly aliceReauthentication: CookieEvidence;
	};
	readonly requestCookieNames: {
		readonly appAsset: readonly string[];
		readonly aliceSlot: readonly string[];
		readonly bobSlot: readonly string[];
	};
	readonly checks: { readonly [Check in NativeCheck]: true };
	readonly d1Opened: boolean;
	readonly cleanup: {
		readonly aliceDeleted: true;
		readonly bobDeleted: true;
		readonly remainingDisposableUsers: 0;
		readonly verifiedAtUtc: string;
	};
}

/** What `init` writes. Every observed fact starts unset, so an unfilled template fails validation. */
export type NativeEvidenceTemplate = Omit<
	NativeAuthSlotEvidence,
	'checks' | 'd1Opened' | 'cleanup'
> & {
	readonly checks: { readonly [Check in NativeCheck]: null };
	readonly d1Opened: null;
	readonly cleanup: {
		readonly aliceDeleted: null;
		readonly bobDeleted: null;
		readonly remainingDisposableUsers: null;
		readonly verifiedAtUtc: string;
	};
};

const FORBIDDEN_KEYS = new Set([
	'accessToken',
	'authorizationCode',
	'authorizationState',
	'cookieHeader',
	'cookieValue',
	'password',
	'nonce',
	'rawHeader',
	'refreshToken',
	'sealedSession',
	'state'
]);

const cookieName = (kind: AuthSlotCookieKind, slotId: string) => `__Secure-maal_${kind}_${slotId}`;

/**
 * Measures one slot cookie from raw `Set-Cookie` header values and returns only safe metadata.
 * `kind` picks the session cookie (default) or the identity cookie.
 */
export function inspectSessionSetCookie(
	headers: readonly { readonly name: string; readonly value: string }[],
	slotId: string,
	kind: AuthSlotCookieKind = 'session'
): CookieEvidence {
	const expectedName = cookieName(kind, slotId);
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

export function createNativeEvidenceTemplate(target: NativeAuthSlotTarget): NativeEvidenceTemplate {
	const cookie: CookieEvidence = {
		name: '<cookie name>',
		bytes: 0,
		path: '<exact slot path>',
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
		cookies: {
			aliceInitial: { ...cookie },
			bobInitial: { ...cookie },
			aliceRefresh: { ...cookie },
			aliceReauthentication: { ...cookie }
		},
		identityCookies: {
			aliceInitial: { ...cookie },
			bobInitial: { ...cookie },
			aliceReauthentication: { ...cookie }
		},
		requestCookieNames: { appAsset: [], aliceSlot: [], bobSlot: [] },
		checks: {
			stableRegisteredCallback: null,
			opaqueOneUseFlowState: null,
			distinctIdentities: null,
			aliceSurvivedBobLogin: null,
			bobSurvivedAliceRefresh: null,
			bobSurvivedAliceRevocation: null,
			aliceReauthenticationBoundIdentity: null,
			bobSurvivedAliceRemoval: null
		},
		d1Opened: null,
		cleanup: {
			aliceDeleted: null,
			bobDeleted: null,
			remainingDisposableUsers: null,
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
		'cookies',
		'identityCookies',
		'requestCookieNames',
		'checks',
		'd1Opened',
		'cleanup'
	]);
	assert(
		value.schemaVersion === AUTH_SLOT_PROOF_SCHEMA_VERSION,
		`schemaVersion must be ${AUTH_SLOT_PROOF_SCHEMA_VERSION}`
	);
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

	assertObject(value.cookies, 'cookies');
	assertKeys(value.cookies, 'cookies', [
		'aliceInitial',
		'bobInitial',
		'aliceRefresh',
		'aliceReauthentication'
	]);
	validateCookieEvidence(value.cookies.aliceInitial, 'cookies.aliceInitial', 'session');
	validateCookieEvidence(value.cookies.bobInitial, 'cookies.bobInitial', 'session');
	validateCookieEvidence(value.cookies.aliceRefresh, 'cookies.aliceRefresh', 'session');
	validateCookieEvidence(
		value.cookies.aliceReauthentication,
		'cookies.aliceReauthentication',
		'session'
	);
	const alicePath = value.cookies.aliceInitial.path;
	const bobPath = value.cookies.bobInitial.path;
	assert(alicePath !== bobPath, 'Alice and Bob must use distinct cookies');
	assert(
		value.cookies.aliceRefresh.path === alicePath &&
			value.cookies.aliceReauthentication.path === alicePath,
		'Alice session responses must use the Alice cookie'
	);

	assertObject(value.identityCookies, 'identityCookies');
	assertKeys(value.identityCookies, 'identityCookies', [
		'aliceInitial',
		'bobInitial',
		'aliceReauthentication'
	]);
	validateCookieEvidence(
		value.identityCookies.aliceInitial,
		'identityCookies.aliceInitial',
		'identity'
	);
	validateCookieEvidence(
		value.identityCookies.bobInitial,
		'identityCookies.bobInitial',
		'identity'
	);
	validateCookieEvidence(
		value.identityCookies.aliceReauthentication,
		'identityCookies.aliceReauthentication',
		'identity'
	);
	assert(
		value.identityCookies.aliceInitial.path === alicePath &&
			value.identityCookies.aliceReauthentication.path === alicePath,
		'Alice identity cookies must use the Alice slot'
	);
	assert(
		value.identityCookies.bobInitial.path === bobPath,
		'Bob identity cookie must use the Bob slot'
	);

	assertObject(value.requestCookieNames, 'requestCookieNames');
	assertKeys(value.requestCookieNames, 'requestCookieNames', ['appAsset', 'aliceSlot', 'bobSlot']);
	const { appAsset, aliceSlot, bobSlot } = value.requestCookieNames;
	assertStringArray(appAsset, 'requestCookieNames.appAsset');
	assertStringArray(aliceSlot, 'requestCookieNames.aliceSlot');
	assertStringArray(bobSlot, 'requestCookieNames.bobSlot');
	const aliceCookies = [value.cookies.aliceInitial.name, value.identityCookies.aliceInitial.name];
	const bobCookies = [value.cookies.bobInitial.name, value.identityCookies.bobInitial.name];
	const retainedCookie = /^__Secure-maal_(session|identity)_/;
	assert(
		!appAsset.some((name) => retainedCookie.test(name)),
		'app assets must receive no retained auth-slot cookie'
	);
	assert(
		aliceCookies.every((name) => aliceSlot.includes(name)),
		'Alice route must receive the Alice session and identity cookies'
	);
	assert(!bobCookies.some((name) => aliceSlot.includes(name)), 'Alice route received a Bob cookie');
	assert(
		bobCookies.every((name) => bobSlot.includes(name)),
		'Bob route must receive the Bob session and identity cookies'
	);
	assert(
		!aliceCookies.some((name) => bobSlot.includes(name)),
		'Bob route received an Alice cookie'
	);
	assert(
		aliceSlot.filter((name) => retainedCookie.test(name)).length === aliceCookies.length,
		'Alice route must receive exactly its own auth-slot cookies'
	);
	assert(
		bobSlot.filter((name) => retainedCookie.test(name)).length === bobCookies.length,
		'Bob route must receive exactly its own auth-slot cookies'
	);

	assertObject(value.checks, 'checks');
	assertKeys(value.checks, 'checks', NATIVE_CHECKS);
	for (const check of NATIVE_CHECKS) {
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

/** Validates the release matrix: exactly one valid evidence file per native target. */
export function validateNativeMatrix(
	files: readonly unknown[]
): asserts files is readonly NativeAuthSlotEvidence[] {
	assert(
		files.length === NATIVE_AUTH_SLOT_TARGETS.length,
		`The native matrix needs exactly three files, one each for ${NATIVE_AUTH_SLOT_TARGETS.join(', ')}`
	);
	const seen = new Set<NativeAuthSlotTarget>();
	for (const file of files) {
		validateNativeEvidence(file);
		assert(!seen.has(file.target), `The native matrix has more than one file for ${file.target}`);
		seen.add(file.target);
	}
}

function validateCookieEvidence(
	value: unknown,
	label: string,
	kind: AuthSlotCookieKind
): asserts value is CookieEvidence {
	assertObject(value, label);
	assertKeys(value, label, ['name', 'bytes', 'path', 'secure', 'httpOnly', 'sameSite', 'hostOnly']);
	const prefix = cookieName(kind, '');
	assertString(value.name, `${label}.name`, new RegExp(`^${prefix}[a-f0-9]{32}$`));
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
	const slotId = value.name.slice(prefix.length);
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
