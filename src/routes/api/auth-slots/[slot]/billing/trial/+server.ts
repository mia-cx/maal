import { json } from '@sveltejs/kit';

import { BillingTrialRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	configuredTrialDays,
	createStripeClient,
	readBillingRequest,
	requireBillingActor,
	startMaalTrial,
	stripeProductId
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingTrialRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		await startMaalTrial({
			stripe: createStripeClient(event.platform?.env),
			repository: new BillingRepository(event.platform!.env.DB),
			productId: stripeProductId(event.platform?.env),
			householdId: input.householdId,
			workosUserId: actor.workosUserId,
			email: actor.email,
			...(input.priceId ? { priceId: input.priceId } : {}),
			trialDays: configuredTrialDays(event.platform?.env),
			now: new Date().toISOString()
		});
		return json({ started: true });
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
