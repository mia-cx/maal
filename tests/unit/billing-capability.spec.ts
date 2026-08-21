import { describe, expect, it } from 'vitest';

import {
	BILLING_GRACE_MILLISECONDS,
	graceWindowForStatus,
	projectBillingCapability,
	stripeEventIsNewer
} from '$lib/domain/billing/index.js';

const row = {
	householdId: 'org_kitchen',
	status: 'active' as const,
	subscriberUserId: 'user_alice',
	stripePriceId: 'price_monthly',
	currentPeriodEnd: '2026-09-21T12:00:00.000Z',
	cancelAtPeriodEnd: false,
	interruptionStartedAt: null,
	graceUntil: null
};

describe('billing capability projection', () => {
	it('grants the same capability to active and trialing subscriptions', () => {
		for (const status of ['active', 'trialing'] as const) {
			expect(
				projectBillingCapability({ ...row, status }, '2026-08-21T12:00:00.000Z')
			).toMatchObject({ state: 'enabled', stripeStatus: status, source: 'stripe-d1' });
		}
	});

	it('keeps past-due and paused service in one continuous 30-day grace window', () => {
		const first = graceWindowForStatus('past_due', null, '2026-08-01T00:00:00.000Z', false);
		const paused = graceWindowForStatus(
			'paused',
			first.interruptionStartedAt,
			'2026-08-20T00:00:00.000Z',
			false
		);
		expect(paused).toEqual(first);
		expect(Date.parse(first.graceUntil!) - Date.parse(first.interruptionStartedAt!)).toBe(
			BILLING_GRACE_MILLISECONDS
		);
		expect(
			projectBillingCapability({ ...row, status: 'paused', ...paused }, '2026-08-30T23:59:59.000Z')
				.state
		).toBe('grace');
		expect(
			projectBillingCapability({ ...row, status: 'paused', ...paused }, '2026-09-01T00:00:00.001Z')
				.state
		).toBe('disabled');
	});

	it('resets the interruption only after a successful paid period', () => {
		expect(
			graceWindowForStatus('active', '2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z', true)
		).toEqual({ interruptionStartedAt: null, graceUntil: null });
	});

	it('orders Stripe projections by event creation and event id', () => {
		expect(
			stripeEventIsNewer(
				{ createdAt: '2026-08-21T12:00:00.000Z', id: 'evt_b' },
				{ createdAt: '2026-08-21T12:00:00.000Z', id: 'evt_a' }
			)
		).toBe(true);
		expect(
			stripeEventIsNewer(
				{ createdAt: '2026-08-20T12:00:00.000Z', id: 'evt_z' },
				{ createdAt: '2026-08-21T12:00:00.000Z', id: 'evt_a' }
			)
		).toBe(false);
	});
});
