import { error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { createStripeClient, getStripeWebhookSecret } from './stripe';
import {
	deleteSubscriptionRecord,
	findStripeSubscriptionRecordBySubscriptionId,
	findStripeCustomerSubscription,
	upsertSubscription
} from './subscriptions';

const stringId = (value: string | { id: string } | null | undefined): string | null => {
	if (!value) return null;
	return typeof value === 'string' ? value : value.id;
};

const subscriptionFromCheckout = async (
	stripe: Stripe,
	session: Stripe.Checkout.Session
): Promise<Stripe.Subscription | null> => {
	const subscriptionId = stringId(session.subscription);
	if (!subscriptionId) return null;
	return stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
};

const terminalSubscriptionStatuses = new Set<Stripe.Subscription.Status>([
	'canceled',
	'incomplete_expired'
]);

export const isRollbackMarkedTrialSubscription = (subscription: Stripe.Subscription): boolean =>
	subscription.metadata.maal_trial_rollback === 'start_failed';

export const isTerminalSubscription = (subscription: Stripe.Subscription): boolean =>
	terminalSubscriptionStatuses.has(subscription.status);

export const isTerminalRolledBackTrialSubscription = (subscription: Stripe.Subscription): boolean =>
	isRollbackMarkedTrialSubscription(subscription) && isTerminalSubscription(subscription);

export const deletedSubscriptionRequiresExactMatch = (eventType: Stripe.Event.Type): boolean =>
	eventType === 'customer.subscription.deleted';

export const shouldIgnoreUnknownDeletedSubscription = (input: {
	eventType: Stripe.Event.Type;
	existingHouseholdId: string | null;
}): boolean =>
	deletedSubscriptionRequiresExactMatch(input.eventType) && input.existingHouseholdId === null;

export const householdIdForSubscriptionEvent = (input: {
	eventType: Stripe.Event.Type;
	exactSubscriptionHouseholdId: string | null;
	customerSubscription: { householdId: string; subscriptionId: string | null } | null;
	metadataHouseholdId?: string | null;
}): string | null => {
	if (input.exactSubscriptionHouseholdId) return input.exactSubscriptionHouseholdId;
	if (input.customerSubscription?.subscriptionId === null)
		return input.customerSubscription.householdId;
	if (input.eventType === 'customer.subscription.created') {
		return input.metadataHouseholdId ?? input.customerSubscription?.householdId ?? null;
	}
	if (input.customerSubscription) return null;
	return input.metadataHouseholdId ?? null;
};

export const shouldDeleteRollbackSubscription = (input: {
	subscription: Stripe.Subscription;
	localStatus?: string | null;
}): boolean =>
	isTerminalSubscription(input.subscription) &&
	(input.localStatus === 'trial_rollback_pending' ||
		isRollbackMarkedTrialSubscription(input.subscription));

export const shouldSuppressRollbackSubscription = (input: {
	subscription: Stripe.Subscription;
	localStatus?: string | null;
}): boolean => shouldDeleteRollbackSubscription(input);

const stripeEventFromRequest = async (platform: App.Platform, request: Request) => {
	const stripe = createStripeClient(platform);
	const webhookSecret = getStripeWebhookSecret(platform);
	const signature = request.headers.get('stripe-signature');
	if (!signature) error(400, { message: 'Missing Stripe signature.' });

	const payload = await request.text();
	try {
		return {
			stripe,
			event: await stripe.webhooks.constructEventAsync(
				payload,
				signature,
				webhookSecret,
				undefined,
				Stripe.createSubtleCryptoProvider()
			)
		};
	} catch (cause) {
		console.error(cause);
		error(400, { message: 'Invalid Stripe signature.' });
	}
};

export const handleStripeWebhook = async (platform: App.Platform | undefined, request: Request) => {
	if (!platform?.env.DB) error(503, { message: 'Billing storage is not available.' });
	const { stripe, event } = await stripeEventFromRequest(platform, request);

	if (event.type === 'checkout.session.completed') {
		const session = event.data.object as Stripe.Checkout.Session;
		if (session.mode !== 'subscription' || !session.subscription) return;

		const householdId = session.client_reference_id;
		const customerId = stringId(session.customer);
		if (householdId && customerId) {
			await upsertSubscription({
				database: platform.env.DB,
				householdId,
				customerId,
				subscriberUserId: session.metadata?.workosUserId ?? null,
				subscription: await subscriptionFromCheckout(stripe, session),
				status: session.status ?? 'complete'
			});
		}
	}

	if (
		event.type === 'customer.subscription.created' ||
		event.type === 'customer.subscription.updated' ||
		event.type === 'customer.subscription.deleted'
	) {
		const subscription = event.data.object as Stripe.Subscription;
		const customerId = stringId(subscription.customer);
		const exactSubscriptionRecord = await findStripeSubscriptionRecordBySubscriptionId({
			database: platform.env.DB,
			subscriptionId: subscription.id
		});
		const exactSubscriptionHouseholdId = exactSubscriptionRecord?.householdId ?? null;
		const customerSubscription =
			!exactSubscriptionHouseholdId && customerId
				? await findStripeCustomerSubscription({
						database: platform.env.DB,
						customerId
					})
				: null;
		const existingHouseholdId = deletedSubscriptionRequiresExactMatch(event.type)
			? exactSubscriptionHouseholdId
			: householdIdForSubscriptionEvent({
					eventType: event.type,
					exactSubscriptionHouseholdId,
					customerSubscription,
					metadataHouseholdId: subscription.metadata.householdId
				});
		const householdId = existingHouseholdId;
		if (shouldIgnoreUnknownDeletedSubscription({ eventType: event.type, existingHouseholdId }))
			return;
		if (
			customerId &&
			shouldDeleteRollbackSubscription({
				subscription,
				localStatus: exactSubscriptionRecord?.status
			})
		) {
			await deleteSubscriptionRecord({
				database: platform.env.DB,
				householdId,
				customerId,
				subscriptionId: subscription.id
			});
			return;
		}
		if (householdId && customerId) {
			await upsertSubscription({
				database: platform.env.DB,
				householdId,
				customerId,
				subscriberUserId: subscription.metadata.workosUserId ?? null,
				subscription
			});
		}
	}
};
