import { describe, expect, it } from 'vitest';
import {
	createNativeEvidenceTemplate,
	inspectSessionSetCookie,
	requestCookieNames,
	validateNativeEvidence
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

	it('accepts complete native evidence and rejects secret-bearing or incomplete files', () => {
		const evidence = completeEvidence();
		expect(() => validateNativeEvidence(evidence)).not.toThrow();
		expect(() => validateNativeEvidence({ ...evidence, password: 'nope' })).toThrow(/forbidden/);
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
		identities: {
			aliceWorkosUserId: 'user_alice',
			bobWorkosUserId: 'user_bob',
			aliceSessionId: 'session_alice',
			bobSessionId: 'session_bob'
		},
		cookies: {
			alice: cookieEvidence(ALICE_SLOT, 2200),
			bob: cookieEvidence(BOB_SLOT, 2250)
		},
		requestCookieNames: {
			appAsset: [],
			aliceSlot: [`__Secure-maal_session_${ALICE_SLOT}`],
			bobSlot: [`__Secure-maal_session_${BOB_SLOT}`]
		},
		cleanup: { ...template.cleanup, verifiedAtUtc: '2026-08-22T01:10:00.000Z' }
	};
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
