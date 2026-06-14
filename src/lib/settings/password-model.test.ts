import { describe, expect, it } from 'vitest';
import { emptyPasswordChangeFields, passwordChangeMismatch } from './password-model';

describe('password model', () => {
	it('reports mismatched confirmation', () => {
		expect(passwordChangeMismatch('new-password', 'different')).toBe('Passwords do not match.');
		expect(passwordChangeMismatch('new-password', 'new-password')).toBeNull();
	});

	it('does not show mismatch before confirmation is entered', () => {
		expect(passwordChangeMismatch('new-password', '')).toBeNull();
	});

	it('provides empty password fields', () => {
		expect(emptyPasswordChangeFields()).toEqual({
			currentPassword: '',
			newPassword: '',
			confirmPassword: ''
		});
	});
});
