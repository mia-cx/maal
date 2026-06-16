import { resolve } from '$app/paths';
import { readSettingsError } from '$lib/settings/api-client';
import type { BillingStatus } from '$lib/settings/types';

export const loadBillingStatus = async (): Promise<
	{ ok: true; status: BillingStatus } | { ok: false; error: string }
> => {
	const response = await fetch(resolve('/billing/status'));
	if (!response.ok) {
		return { ok: false, error: await readSettingsError(response, 'Could not load billing.') };
	}
	return { ok: true, status: (await response.json()) as BillingStatus };
};

export const createBillingPortalSession = async (
	householdId: string
): Promise<{ ok: true; url?: string } | { ok: false; error: string }> => {
	const response = await fetch(resolve('/billing/portal'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ householdId })
	});
	if (!response.ok) {
		return {
			ok: false,
			error: await readSettingsError(response, 'Could not open billing portal.')
		};
	}
	return { ok: true, ...((await response.json()) as { url?: string }) };
};
