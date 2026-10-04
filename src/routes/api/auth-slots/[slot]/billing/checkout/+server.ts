import { json } from '@sveltejs/kit';

import { BillingCheckoutRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	createMaalCheckout,
	createStripeClient,
	readBillingRequest,
	requireBillingActor,
	stripeProductId
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingCheckoutRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		return json(
			await createMaalCheckout({
				stripe: createStripeClient(event.platform?.env),
				repository: new BillingRepository(event.platform!.env.DB),
				productId: stripeProductId(event.platform?.env),
				householdId: input.householdId,
				workosUserId: actor.workosUserId,
				email: actor.email,
				priceId: input.priceId,
				origin: event.url.origin,
				idempotencyKey: input.idempotencyKey,
				now: new Date().toISOString()
			})
		);
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
