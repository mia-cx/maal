import Stripe from 'stripe';

import type { BillingRepository } from './repository.js';
import { projectionFromStripeSubscription } from './subscriptions.js';

const utcFromSeconds = (seconds: number): `${string}Z` =>
	new Date(seconds * 1_000).toISOString() as `${string}Z`;

const expandedId = (value: string | { id: string } | null): string | null =>
	value === null ? null : typeof value === 'string' ? value : value.id;

const subscriptionForEvent = async (
	stripe: Stripe,
	event: Stripe.Event
): Promise<Stripe.Subscription | null> => {
	const object = event.data.object;
	if (object.object === 'subscription') return object;
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

const supportedEventTypes = new Set([
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.paid',
	'invoice.payment_succeeded',
	'invoice.payment_failed'
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
		await input.repository.commitStripeProjection(
			input.event.id,
			projectionFromStripeSubscription({
				subscription,
				householdId,
				subscriberUserId: subscription.metadata.workosUserId || existing?.subscriberUserId || null,
				eventId: input.event.id,
				eventCreatedAt: utcFromSeconds(input.event.created),
				eventReceivedAt: input.receivedAt,
				existing,
				paidPeriodSucceeded:
					input.event.type === 'invoice.paid' || input.event.type === 'invoice.payment_succeeded'
			}),
			input.receivedAt
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
