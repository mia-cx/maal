import { describe, expect, it } from 'vitest';
import {
	accountEmailChanged,
	accountEmailVerified,
	emailVerificationRequired,
	normalizedEmail,
	verificationAttemptKey
} from './account-model';

describe('account settings model', () => {
	it('normalizes and compares account emails', () => {
		expect(normalizedEmail(' Mia@Example.COM ')).toBe('mia@example.com');
		expect(accountEmailChanged('Mia@example.com', 'mia@example.com')).toBe(false);
		expect(accountEmailChanged('new@example.com', 'mia@example.com')).toBe(true);
	});

	it('detects verification state', () => {
		expect(accountEmailVerified('Mia@example.com', 'mia@example.com')).toBe(true);
		expect(emailVerificationRequired('new@example.com', 'mia@example.com', null)).toBe(true);
		expect(emailVerificationRequired('new@example.com', 'mia@example.com', 'new@example.com')).toBe(
			false
		);
	});

	it('builds verification attempt keys', () => {
		expect(verificationAttemptKey('mia@example.com', '123456')).toBe('mia@example.com:123456');
	});
});
