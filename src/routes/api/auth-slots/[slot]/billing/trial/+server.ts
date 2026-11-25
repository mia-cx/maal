import { json } from '@sveltejs/kit';

import { BillingTrialRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	readBillingRequest,
	requireBillingActor,
	startConfiguredMaalTrial
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingTrialRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		await startConfiguredMaalTrial(event.platform?.env, {
			repository: new BillingRepository(event.platform!.env.DB),
			householdId: input.householdId,
			workosUserId: actor.workosUserId,
			email: actor.email,
			...(input.priceId ? { priceId: input.priceId } : {}),
			now: new Date().toISOString()
		});
		return json({ started: true });
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
