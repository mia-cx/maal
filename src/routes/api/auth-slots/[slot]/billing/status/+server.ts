import { json } from '@sveltejs/kit';
import { Schema } from 'effect';

import { BillingHouseholdRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	createStripeClient,
	loadBillingProjection,
	requireBillingActor,
	stripeProductId
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const householdId = event.url.searchParams.get('householdId') ?? '';
		// Query strings still cross the same Effect validation boundary as JSON commands.
		const decoded = Schema.decodeUnknownSync(BillingHouseholdRequestSchema)({ householdId });
		const actor = await requireBillingActor(event, decoded.householdId, null);
		const repository = new BillingRepository(event.platform!.env.DB);
		return json(
			await loadBillingProjection({
				repository,
				stripe: createStripeClient(event.platform?.env),
				productId: stripeProductId(event.platform?.env),
				householdId: decoded.householdId,
				workosUserId: actor.workosUserId,
				now: new Date().toISOString()
			})
		);
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
