import { describe, expect, it } from 'vitest';
import { displayUserName } from './user-display';

describe('displayUserName', () => {
	it('prefers explicit names', () => {
		expect(
			displayUserName({ name: 'Mia', firstName: 'M', lastName: 'Cx', email: 'mia@example.com' })
		).toBe('Mia');
	});

	it('falls back to first and last name', () => {
		expect(displayUserName({ firstName: 'Mia', lastName: 'Cx', email: 'mia@example.com' })).toBe(
			'Mia Cx'
		);
	});

	it('falls back to email local part', () => {
		expect(displayUserName({ email: 'mia@example.com' })).toBe('mia');
	});
});
