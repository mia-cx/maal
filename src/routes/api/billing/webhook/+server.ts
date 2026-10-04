import { json } from '@sveltejs/kit';

import {
	BillingRepository,
	billingErrorResponse,
	createStripeClient,
	processStripeWebhook,
	stripeEventFromRequest,
	stripeWebhookSecret
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		if (!event.platform?.env.DB) throw new Error('Billing storage unavailable');
		const stripe = createStripeClient(event.platform.env);
		const stripeEvent = await stripeEventFromRequest({
			stripe,
			request: event.request,
			webhookSecret: stripeWebhookSecret(event.platform.env)
		});
		const result = await processStripeWebhook({
			stripe,
			repository: new BillingRepository(event.platform.env.DB),
			event: stripeEvent,
			receivedAt: new Date().toISOString()
		});
		return json({ received: true, result });
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
