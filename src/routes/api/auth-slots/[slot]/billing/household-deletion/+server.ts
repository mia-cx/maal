import { json } from '@sveltejs/kit';

import { BillingHouseholdRequestSchema } from '$lib/domain/billing/contracts.js';
import {
	BillingRepository,
	billingErrorResponse,
	createStripeClient,
	deleteHouseholdAfterRefund,
	readBillingRequest,
	recoverDeletedHousehold,
	requireBillingActor
} from '$lib/server/billing/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingHouseholdRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		return json(
			await deleteHouseholdAfterRefund({
				stripe: createStripeClient(event.platform?.env),
				repository: new BillingRepository(event.platform!.env.DB),
				householdId: input.householdId,
				requesterUserId: actor.workosUserId,
				now: new Date().toISOString()
			})
		);
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const input = await readBillingRequest(event.request, BillingHouseholdRequestSchema);
		const actor = await requireBillingActor(event, input.householdId);
		await recoverDeletedHousehold({
			repository: new BillingRepository(event.platform!.env.DB),
			householdId: input.householdId,
			actorUserId: actor.workosUserId,
			now: new Date().toISOString()
		});
		return json({ recovered: true });
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
