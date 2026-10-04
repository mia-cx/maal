import { json } from '@sveltejs/kit';

import { BillingHouseholdRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	createMaalPortal,
	createStripeClient,
	readBillingRequest,
	requireBillingActor
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingHouseholdRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		return json(
			await createMaalPortal({
				stripe: createStripeClient(event.platform?.env),
				repository: new BillingRepository(event.platform!.env.DB),
				householdId: input.householdId,
				workosUserId: actor.workosUserId,
				origin: event.url.origin
			})
		);
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
