import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildPolicy,
	currentLegalDate,
	getPolicy,
	getPolicyList,
	getPolicyVersion
} from './policies';

describe('legal policies', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('computes the current legal date when called', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-11T23:59:59.000Z'));
		expect(currentLegalDate()).toBe('2026-06-11');

		vi.setSystemTime(new Date('2026-06-12T00:00:00.000Z'));
		expect(currentLegalDate()).toBe('2026-06-12');
	});

	it('builds current/archive flags with a per-call cutoff date', () => {
		const policy = buildPolicy('privacy', '2026-06-12');

		expect(policy.current.version).toBe('2026-06-12');
		expect(policy.versions).toContainEqual(
			expect.objectContaining({ version: '2026-06-12', archived: false })
		);
	});

	it('resolves policy lists and versions from the same per-call policy snapshot', () => {
		expect(getPolicyList('2026-06-12').map((policy) => policy.slug)).toEqual([
			'privacy',
			'terms',
			'cookies'
		]);
		expect(getPolicy('missing', '2026-06-12')).toBeNull();
		expect(getPolicyVersion('privacy', '2026-06-12', '2026-06-12')).toEqual(
			expect.objectContaining({ policy: 'privacy', version: '2026-06-12', archived: false })
		);
	});
});
