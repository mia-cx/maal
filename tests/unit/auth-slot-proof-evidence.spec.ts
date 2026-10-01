import { describe, expect, it } from 'vitest';
import {
	NATIVE_AUTH_SLOT_TARGETS,
	createNativeEvidenceTemplate,
	inspectSessionSetCookie,
	requestCookieNames,
	validateNativeEvidence,
	validateNativeMatrix
} from '../../scripts/lib/auth-slot-proof-evidence.ts';

const ALICE_SLOT = '00112233445566778899aabbccddeeff';
const BOB_SLOT = 'ffeeddccbbaa99887766554433221100';

describe('auth-slot proof evidence', () => {
	it('measures the exact Set-Cookie line and retains only safe attributes', () => {
		const line = [
			`__Secure-maal_session_${ALICE_SLOT}=sealed-secret`,
			`Path=/api/auth-slots/${ALICE_SLOT}/`,
			'HttpOnly',
			'Secure',
			'SameSite=Lax',
			'Max-Age=31536000'
		].join('; ');

		expect(inspectSessionSetCookie([{ name: 'set-cookie', value: line }], ALICE_SLOT)).toEqual({
			name: `__Secure-maal_session_${ALICE_SLOT}`,
			bytes: new TextEncoder().encode(line).byteLength,
			path: `/api/auth-slots/${ALICE_SLOT}/`,
			secure: true,
			httpOnly: true,
			sameSite: 'Lax',
			hostOnly: true
		});
	});

	it('rejects missing attributes and Domain-scoped cookies', () => {
		const base = `__Secure-maal_session_${ALICE_SLOT}=secret; Path=/api/auth-slots/${ALICE_SLOT}/; HttpOnly; Secure; SameSite=Lax`;
		expect(() =>
			inspectSessionSetCookie(
				[{ name: 'set-cookie', value: `${base}; Domain=maal.test` }],
				ALICE_SLOT
			)
		).toThrow(/host-only/);
		expect(() =>
			inspectSessionSetCookie(
				[{ name: 'set-cookie', value: base.replace('; Secure', '') }],
				ALICE_SLOT
			)
		).toThrow(/Secure/);
	});

	it('records request cookie names without values', () => {
		expect(requestCookieNames('one=secret; two=another-secret')).toEqual(['one', 'two']);
		expect(requestCookieNames(null)).toEqual([]);
	});

	it('measures the sealed identity cookie with the same policy', () => {
		const line = `__Secure-maal_identity_${ALICE_SLOT}=sealed; Path=/api/auth-slots/${ALICE_SLOT}/; HttpOnly; Secure; SameSite=Lax`;
		expect(
			inspectSessionSetCookie([{ name: 'set-cookie', value: line }], ALICE_SLOT, 'identity')
		).toMatchObject({ name: `__Secure-maal_identity_${ALICE_SLOT}`, bytes: line.length });
		expect(() =>
			inspectSessionSetCookie([{ name: 'set-cookie', value: line }], ALICE_SLOT)
		).toThrow(/did not set __Secure-maal_session_/);
		const oversized = line.replace('=sealed;', `=${'x'.repeat(4096)};`);
		expect(() =>
			inspectSessionSetCookie([{ name: 'set-cookie', value: oversized }], ALICE_SLOT, 'identity')
		).toThrow(/bytes/);
	});

	it('starts every observed fact unset so an unfilled template cannot pass', () => {
		const template = createNativeEvidenceTemplate('native-macos-safari');
		expect(Object.values(template.checks).every((check) => check === null)).toBe(true);
		expect(template.d1Opened).toBeNull();
		expect(template.cleanup).toMatchObject({
			aliceDeleted: null,
			bobDeleted: null,
			remainingDisposableUsers: null
		});

		const evidence = completeEvidence();
		expect(() => validateNativeEvidence({ ...evidence, checks: template.checks })).toThrow(
			/checks.stableRegisteredCallback must pass/
		);
		expect(() => validateNativeEvidence({ ...evidence, d1Opened: null })).toThrow(/measured/);
		expect(() =>
			validateNativeEvidence({ ...evidence, cleanup: { ...evidence.cleanup, bobDeleted: null } })
		).toThrow(/Bob deletion/);
	});

	it('requires identity cookies that stay on their own slot', () => {
		const evidence = completeEvidence();
		expect(() => validateNativeEvidence({ ...evidence, identityCookies: undefined })).toThrow(
			/identityCookies must be an object/
		);
		expect(() =>
			validateNativeEvidence({
				...evidence,
				identityCookies: {
					...evidence.identityCookies,
					aliceInitial: identityEvidence(BOB_SLOT, 300)
				}
			})
		).toThrow(/Alice identity cookies must use the Alice slot/);
		expect(() =>
			validateNativeEvidence({
				...evidence,
				identityCookies: {
					...evidence.identityCookies,
					bobInitial: identityEvidence(BOB_SLOT, 4096)
				}
			})
		).toThrow(/identityCookies.bobInitial.bytes is invalid/);
		expect(() =>
			validateNativeEvidence({
				...evidence,
				requestCookieNames: {
					...evidence.requestCookieNames,
					bobSlot: [...evidence.requestCookieNames.bobSlot, `__Secure-maal_identity_${ALICE_SLOT}`]
				}
			})
		).toThrow(/Bob route received an Alice cookie/);
	});

	it('accepts exactly one file per native target', () => {
		const files = NATIVE_AUTH_SLOT_TARGETS.map((target) => ({ ...completeEvidence(), target }));
		const [macos, ios, android] = files;
		expect(() => validateNativeMatrix(files)).not.toThrow();
		expect(() => validateNativeMatrix([macos, ios, android, macos])).toThrow(/exactly three/);
		expect(() => validateNativeMatrix([macos, macos, android])).toThrow(
			/more than one file for native-macos-safari/
		);
		expect(() => validateNativeMatrix([macos, ios])).toThrow(/exactly three/);
	});

	it('accepts complete native evidence and rejects secret-bearing or incomplete files', () => {
		const evidence = completeEvidence();
		expect(() => validateNativeEvidence(evidence)).not.toThrow();
		expect(() => validateNativeEvidence({ ...evidence, password: 'nope' })).toThrow(/forbidden/);
		expect(() => validateNativeEvidence({ ...evidence, state: 'opaque-but-replayable' })).toThrow(
			/forbidden/
		);
		expect(() =>
			validateNativeEvidence({
				...evidence,
				cleanup: { ...evidence.cleanup, remainingDisposableUsers: 1 }
			})
		).toThrow(/zero disposable users/);
	});
});

function completeEvidence() {
	const template = createNativeEvidenceTemplate('native-macos-safari');
	return {
		...template,
		gitCommit: 'a'.repeat(40),
		stagingDeploymentLabel: 'staging-auth-proof-70',
		runAtUtc: '2026-08-22T01:00:00.000Z',
		device: { hardwareModel: 'MacBook Pro', osName: 'macOS', osVersion: '26.0' },
		browser: { name: 'Safari', version: '26.0', userAgent: 'native Safari user agent' },
		cookies: {
			aliceInitial: cookieEvidence(ALICE_SLOT, 2200),
			bobInitial: cookieEvidence(BOB_SLOT, 2250),
			aliceRefresh: cookieEvidence(ALICE_SLOT, 2210),
			aliceReauthentication: cookieEvidence(ALICE_SLOT, 2220)
		},
		identityCookies: {
			aliceInitial: identityEvidence(ALICE_SLOT, 300),
			bobInitial: identityEvidence(BOB_SLOT, 300),
			aliceReauthentication: identityEvidence(ALICE_SLOT, 300)
		},
		requestCookieNames: {
			appAsset: [],
			aliceSlot: [`__Secure-maal_identity_${ALICE_SLOT}`, `__Secure-maal_session_${ALICE_SLOT}`],
			bobSlot: [`__Secure-maal_identity_${BOB_SLOT}`, `__Secure-maal_session_${BOB_SLOT}`]
		},
		checks: {
			stableRegisteredCallback: true,
			opaqueOneUseFlowState: true,
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
			verifiedAtUtc: '2026-08-22T01:10:00.000Z'
		}
	};
}

function identityEvidence(slotId: string, bytes: number) {
	return { ...cookieEvidence(slotId, bytes), name: `__Secure-maal_identity_${slotId}` };
}

function cookieEvidence(slotId: string, bytes: number) {
	return {
		name: `__Secure-maal_session_${slotId}`,
		bytes,
		path: `/api/auth-slots/${slotId}/`,
		secure: true as const,
		httpOnly: true as const,
		sameSite: 'Lax' as const,
		hostOnly: true as const
	};
}
