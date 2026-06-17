import { describe, expect, it } from 'vitest';
import { subscriptionExemptPath } from './hooks.server';

describe('subscriptionExemptPath', () => {
	it('keeps household management reachable while premium routes are locked', () => {
		expect(subscriptionExemptPath('/household')).toBe(true);
		expect(subscriptionExemptPath('/household/members')).toBe(true);
		expect(subscriptionExemptPath('/menu')).toBe(false);
	});
});
