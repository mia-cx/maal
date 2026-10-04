import { json } from '@sveltejs/kit';

import { BillingTransferRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	createStripeClient,
	readBillingRequest,
	requireBillingActor,
	transferBillingOwnership
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingTransferRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		await transferBillingOwnership({
			stripe: createStripeClient(event.platform?.env),
			repository: new BillingRepository(event.platform!.env.DB),
			householdId: input.householdId,
			currentUserId: actor.workosUserId,
			newUserId: input.newSubscriberUserId,
			now: new Date().toISOString()
		});
		return json({ transferred: true });
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
