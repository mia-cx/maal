import { describe, expect, it } from 'vitest';
import { isVerificationCode, normalizeVerificationCode } from './verification-code';

describe('verification code helpers', () => {
	it('requires exact digit-only verification codes', () => {
		expect(isVerificationCode('123456')).toBe(true);
		expect(isVerificationCode('12345')).toBe(false);
		expect(isVerificationCode('1234567')).toBe(false);
		expect(isVerificationCode('12345a')).toBe(false);
	});

	it('normalizes string input without stripping malformed content', () => {
		expect(normalizeVerificationCode(' 123456 ')).toBe('123456');
		expect(normalizeVerificationCode(123456)).toBe('');
	});
});
