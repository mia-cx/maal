import { describe, expect, it } from 'vitest';
import { isInvalidEmailChangeCode, WorkosEmailChangeError } from './workos-email-change';

describe('WorkOS email-change errors', () => {
	it('classifies invalid confirmation code statuses as client errors', () => {
		expect(isInvalidEmailChangeCode(new WorkosEmailChangeError('bad code', 400))).toBe(true);
		expect(isInvalidEmailChangeCode(new WorkosEmailChangeError('missing challenge', 404))).toBe(
			true
		);
		expect(isInvalidEmailChangeCode(new WorkosEmailChangeError('unprocessable', 422))).toBe(true);
	});

	it('does not classify provider/auth/outage statuses as invalid user codes', () => {
		expect(isInvalidEmailChangeCode(new WorkosEmailChangeError('unauthorized', 401))).toBe(false);
		expect(isInvalidEmailChangeCode(new WorkosEmailChangeError('outage', 503))).toBe(false);
		expect(isInvalidEmailChangeCode(new Error('network failed'))).toBe(false);
	});
});
