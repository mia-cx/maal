import Stripe from 'stripe';

import { reconcileHouseholdDeletionRefund } from './deletion.js';
import type { BillingRepository } from './repository.js';
import {
	effectiveStripeStatus,
	projectionFromStripeSubscription,
	subscriptionIsOpen
} from './subscriptions.js';

const utcFromSeconds = (seconds: number): `${string}Z` =>
	new Date(seconds * 1_000).toISOString() as `${string}Z`;

const expandedId = (value: string | { id: string } | null): string | null =>
	value === null ? null : typeof value === 'string' ? value : value.id;

const subscriptionForEvent = async (
	stripe: Stripe,
	event: Stripe.Event
): Promise<Stripe.Subscription | null> => {
	const object = event.data.object;
	if (object.object === 'subscription') {
		return stripe.subscriptions.retrieve(object.id, { expand: ['items.data.price'] });
	}
	if (object.object === 'checkout.session') {
		const id = expandedId(object.subscription);
		return id ? stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }) : null;
	}
	if (object.object === 'invoice') {
		const id = expandedId(object.parent?.subscription_details?.subscription ?? null);
		return id ? stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] }) : null;
	}
	return null;
};

const refundForEvent = async (
	stripe: Stripe,
	event: Stripe.Event
): Promise<Stripe.Refund | null> => {
	const object = event.data.object;
	return object.object === 'refund' ? stripe.refunds.retrieve(object.id) : null;
};

const supportedEventTypes = new Set([
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.paid',
	'invoice.payment_succeeded',
	'invoice.payment_failed',
	'refund.created',
	'refund.updated',
	'refund.failed'
]);

export const processStripeWebhook = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	event: Stripe.Event;
	receivedAt: string;
}): Promise<'processed' | 'duplicate' | 'ignored'> => {
	const acquired = await input.repository.beginStripeEvent({
		id: input.event.id,
		type: input.event.type,
		receivedAt: input.receivedAt
	});
	if (acquired === 'duplicate') return 'duplicate';
	try {
		if (!supportedEventTypes.has(input.event.type)) {
			await input.repository.finishStripeEventWithoutProjection(input.event.id, input.receivedAt);
			return 'ignored';
		}
		const refund = await refundForEvent(input.stripe, input.event);
		if (refund) {
			await reconcileHouseholdDeletionRefund({
				repository: input.repository,
				refund,
				now: input.receivedAt
			});
			await input.repository.finishStripeEventWithoutProjection(input.event.id, input.receivedAt);
			return 'processed';
		}
		const subscription = await subscriptionForEvent(input.stripe, input.event);
		if (!subscription) {
			await input.repository.finishStripeEventWithoutProjection(input.event.id, input.receivedAt);
			return 'ignored';
		}
		const existing = await input.repository.subscriptionByStripeId(subscription.id);
		const householdId = subscription.metadata.householdId || existing?.householdId;
		if (!householdId) {
			await input.repository.finishStripeEventWithoutProjection(input.event.id, input.receivedAt);
			return 'ignored';
		}
		// A purged household has no rows to project onto; its late webhooks finish quietly so
		// Stripe stops retrying them.
		const deletion = await input.repository.deletionRequest(householdId);
		if (deletion?.state === 'purged' || !(await input.repository.householdExists(householdId))) {
			await input.repository.finishStripeEventWithoutProjection(input.event.id, input.receivedAt);
			return 'processed';
		}
		// An event for a different subscription than the projected row is normally a superseded
		// duplicate, but a replacement subscription can legitimately arrive before the old one's
		// cancellation event. When the row's subscription is still open in D1, ask Stripe whether
		// it actually ended; only then may this event replace it.
		const row = await input.repository.subscription(householdId);
		let replacesEndedSubscriptionId: string | undefined;
		if (
			row !== null &&
			row.stripeSubscriptionId !== subscription.id &&
			subscriptionIsOpen(row.status)
		) {
			const displaced = await input.stripe.subscriptions.retrieve(row.stripeSubscriptionId);
			if (displaced && subscriptionIsOpen(effectiveStripeStatus(displaced))) {
				await input.repository.finishStripeEventWithoutProjection(input.event.id, input.receivedAt);
				return 'processed';
			}
			replacesEndedSubscriptionId = row.stripeSubscriptionId;
		}
		const eventCreatedAt = utcFromSeconds(input.event.created);
		const paidPeriodSucceeded =
			input.event.type === 'invoice.paid' || input.event.type === 'invoice.payment_succeeded';
		await input.repository.commitStripeProjection(
			input.event.id,
			projectionFromStripeSubscription({
				subscription,
				householdId,
				subscriberUserId: subscription.metadata.workosUserId || existing?.subscriberUserId || null,
				eventId: input.event.id,
				eventCreatedAt,
				existing,
				paidPeriodSucceeded
			}),
			input.receivedAt,
			paidPeriodSucceeded ? eventCreatedAt : null,
			replacesEndedSubscriptionId
		);
		return 'processed';
	} catch (cause) {
		await input.repository.failStripeEvent(input.event.id, safeWebhookErrorCode(cause));
		throw cause;
	}
};

export const stripeEventFromRequest = async (input: {
	stripe: Stripe;
	request: Request;
	webhookSecret: string;
}): Promise<Stripe.Event> => {
	const signature = input.request.headers.get('stripe-signature');
	if (!signature) throw new StripeWebhookSignatureError();
	// Stripe signatures cover the exact raw body, so this route must never parse JSON first.
	const payload = await input.request.text();
	try {
		return await input.stripe.webhooks.constructEventAsync(
			payload,
			signature,
			input.webhookSecret,
			undefined,
			Stripe.createSubtleCryptoProvider()
		);
	} catch {
		throw new StripeWebhookSignatureError();
	}
};

const safeWebhookErrorCode = (cause: unknown): string => {
	if (cause instanceof Error && '_tag' in cause && typeof cause._tag === 'string') {
		return cause._tag.slice(0, 80);
	}
	return 'webhook_projection_failed';
};

export class StripeWebhookSignatureError extends Error {
	readonly _tag = 'StripeWebhookSignatureError';
	constructor() {
		super('The Stripe signature is invalid.');
	}
}
