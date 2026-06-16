import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	isRollbackMarkedTrialSubscription,
	isTerminalRolledBackTrialSubscription
} from './webhook';

const subscription = (
	overrides: Pick<Stripe.Subscription, 'status'> & {
		metadata?: Stripe.Metadata;
	}
): Stripe.Subscription =>
	({
		id: 'sub_1',
		object: 'subscription',
		metadata: {},
		...overrides
	}) as Stripe.Subscription;

describe('rolled-back trial subscriptions', () => {
	it('treats every rollback-marked subscription as non-authoritative for upserts', () => {
		const markedTrialing = subscription({
			status: 'trialing',
			metadata: { maal_trial_rollback: 'start_failed' }
		});

		expect(isRollbackMarkedTrialSubscription(markedTrialing)).toBe(true);
		expect(isTerminalRolledBackTrialSubscription(markedTrialing)).toBe(false);
	});

	it('only deletes persisted billing rows for terminal rollback-marked subscriptions', () => {
		expect(
			isTerminalRolledBackTrialSubscription(
				subscription({ status: 'canceled', metadata: { maal_trial_rollback: 'start_failed' } })
			)
		).toBe(true);
		expect(
			isTerminalRolledBackTrialSubscription(
				subscription({
					status: 'incomplete_expired',
					metadata: { maal_trial_rollback: 'start_failed' }
				})
			)
		).toBe(true);
		expect(
			isTerminalRolledBackTrialSubscription(
				subscription({ status: 'canceled', metadata: { maal_trial_rollback: 'other' } })
			)
		).toBe(false);
	});
});
