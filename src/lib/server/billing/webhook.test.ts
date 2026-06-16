import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	isRollbackMarkedTrialSubscription,
	isTerminalRolledBackTrialSubscription,
	shouldIgnoreUnknownDeletedSubscription
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

	it('ignores deleted subscriptions that no longer match local billing state', () => {
		expect(
			shouldIgnoreUnknownDeletedSubscription({
				eventType: 'customer.subscription.deleted',
				existingHouseholdId: null
			})
		).toBe(true);
		expect(
			shouldIgnoreUnknownDeletedSubscription({
				eventType: 'customer.subscription.deleted',
				existingHouseholdId: 'household_1'
			})
		).toBe(false);
		expect(
			shouldIgnoreUnknownDeletedSubscription({
				eventType: 'customer.subscription.updated',
				existingHouseholdId: null
			})
		).toBe(false);
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
