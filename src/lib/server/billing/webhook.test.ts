import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
	deletedSubscriptionRequiresExactMatch,
	householdIdForSubscriptionEvent,
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

	it('requires deleted subscription events to match an existing local subscription', () => {
		expect(deletedSubscriptionRequiresExactMatch('customer.subscription.deleted')).toBe(true);
		expect(deletedSubscriptionRequiresExactMatch('customer.subscription.updated')).toBe(false);

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

	it('does not match stale subscription updates through a reused customer', () => {
		expect(
			householdIdForSubscriptionEvent({
				exactSubscriptionHouseholdId: null,
				customerSubscription: { householdId: 'household_current', subscriptionId: 'sub_current' },
				metadataHouseholdId: 'household_from_stale_event'
			})
		).toBeNull();
		expect(
			householdIdForSubscriptionEvent({
				exactSubscriptionHouseholdId: 'household_current',
				customerSubscription: null,
				metadataHouseholdId: 'household_from_metadata'
			})
		).toBe('household_current');
		expect(
			householdIdForSubscriptionEvent({
				exactSubscriptionHouseholdId: null,
				customerSubscription: { householdId: 'household_placeholder', subscriptionId: null },
				metadataHouseholdId: 'household_from_metadata'
			})
		).toBe('household_placeholder');
		expect(
			householdIdForSubscriptionEvent({
				exactSubscriptionHouseholdId: null,
				customerSubscription: null,
				metadataHouseholdId: 'household_from_metadata'
			})
		).toBe('household_from_metadata');
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
