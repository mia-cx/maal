import { error, json, type RequestHandler } from '@sveltejs/kit';
import Stripe from 'stripe';
import { createStripeClient, getStripeWebhookSecret } from '$lib/server/billing/stripe';
import {
	findHouseholdIdForStripeSubscription,
	upsertSubscription
} from '$lib/server/billing/subscriptions';

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

export const POST: RequestHandler = async ({ platform, request }) => {
	if (!platform?.env.DB) error(503, { message: 'Billing storage is not available.' });

	const stripe = createStripeClient(platform);
	const signature = request.headers.get('stripe-signature');
	if (!signature) error(400, { message: 'Missing Stripe signature.' });

	const payload = await request.text();
	let event: Stripe.Event;
	try {
		event = await stripe.webhooks.constructEventAsync(
			payload,
			signature,
			getStripeWebhookSecret(platform),
			undefined,
			Stripe.createSubtleCryptoProvider()
		);
	} catch (cause) {
		console.error(cause);
		error(400, { message: 'Invalid Stripe signature.' });
	}

	if (event.type === 'checkout.session.completed') {
		const session = event.data.object as Stripe.Checkout.Session;
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
		const householdId =
			subscription.metadata.householdId ||
			(await findHouseholdIdForStripeSubscription({
				database: platform.env.DB,
				customerId,
				subscriptionId: subscription.id
			}));
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

	return json({ received: true });
};
