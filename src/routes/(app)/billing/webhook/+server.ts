import { json, type RequestHandler } from '@sveltejs/kit';
import { handleStripeWebhook } from '$lib/server/billing/webhook';

export const POST: RequestHandler = async ({ platform, request }) => {
	await handleStripeWebhook(platform, request);
	return json({ received: true });
};
