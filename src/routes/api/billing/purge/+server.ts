import { json } from '@sveltejs/kit';
import { NotFoundException, WorkOS } from '@workos-inc/node';
import { timingSafeEqual } from 'node:crypto';

import {
	BillingRepository,
	billingErrorResponse,
	purgeExpiredHouseholds
} from '$lib/server/billing/index.js';
import { readD1ServerNow } from '$lib/server/maintenance/index.js';
import type { RequestHandler } from './$types';

type MaintenanceEnvironment = {
	readonly BILLING_MAINTENANCE_SECRET?: string;
	readonly WORKOS_API_KEY?: string;
	readonly WORKOS_CLIENT_ID?: string;
};

const timingSafeTextEqual = async (left: string, right: string): Promise<boolean> => {
	const encoder = new TextEncoder();
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(left)),
		crypto.subtle.digest('SHA-256', encoder.encode(right))
	]);
	return timingSafeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
};

export const POST: RequestHandler = async (event) => {
	try {
		if (!event.platform?.env.DB) throw new Error('Billing storage unavailable');
		const environment = event.platform.env as Env & MaintenanceEnvironment;
		const expected = environment.BILLING_MAINTENANCE_SECRET;
		const provided = event.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
		if (!expected || !(await timingSafeTextEqual(provided, expected))) {
			return json({ error: { _tag: 'MaintenanceAuthorizationDenied' } }, { status: 401 });
		}
		if (!environment.WORKOS_API_KEY) throw new Error('WorkOS API key unavailable');
		const workos = new WorkOS(environment.WORKOS_API_KEY, {
			...(environment.WORKOS_CLIENT_ID ? { clientId: environment.WORKOS_CLIENT_ID } : {})
		});
		const result = await purgeExpiredHouseholds({
			repository: new BillingRepository(environment.DB),
			now: await readD1ServerNow(environment.DB),
			deleteWorkOSOrganization: async (householdId) => {
				try {
					await workos.organizations.deleteOrganization(householdId);
				} catch (cause) {
					// A retry after WorkOS succeeded but D1 failed must still finish the purge.
					if (!(cause instanceof NotFoundException)) throw cause;
				}
			}
		});
		return json(result);
	} catch (cause) {
		return billingErrorResponse(cause);
	}
};
