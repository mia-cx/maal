import { tryCreateAuthRuntime } from '$lib/server/auth/workos';
import { loadBillingStatus } from './subscriptions';

const globalGrantTokens = new Set([
	'maal:free',
	'maal:lifetime',
	'maal:employee',
	'maal:beta',
	'maal:reward',
	'free',
	'lifetime',
	'employee',
	'beta',
	'reward'
]);

const grantMetadataKeys = ['maal_entitlement', 'maal_entitlements', 'maal_grant', 'maal_grants'];

const splitGrantList = (value: unknown): string[] =>
	typeof value === 'string'
		? value
				.split(/[\s,;]+/)
				.map((token) => token.trim())
				.filter(Boolean)
		: [];

const billingGrantTokens = (metadata: Record<string, unknown>): Set<string> => {
	const tokens = new Set<string>();
	for (const key of grantMetadataKeys) {
		for (const token of splitGrantList(metadata[key])) tokens.add(token);
	}
	return tokens;
};

const grantsHouseholdAccess = (grants: Set<string>, householdId: string): boolean => {
	if ([...globalGrantTokens].some((token) => grants.has(token))) return true;
	return grants.has(`maal:household:${householdId}`) || grants.has(`household:${householdId}`);
};

export const hasHouseholdBillingGrant = async (input: {
	platform?: App.Platform;
	householdId: string;
}): Promise<boolean> => {
	const runtime = tryCreateAuthRuntime(input.platform);
	if (!runtime) return false;
	const organization = await runtime.workos.organizations.getOrganization(input.householdId);
	return grantsHouseholdAccess(billingGrantTokens(organization.metadata ?? {}), input.householdId);
};

export const hasHouseholdAccess = async (input: {
	platform?: App.Platform;
	database: D1Database;
	householdId: string;
}): Promise<boolean> => {
	if (await hasHouseholdBillingGrant(input).catch(() => false)) return true;
	const billing = await loadBillingStatus(input.database, input.householdId);
	return billing.isPaid;
};

export const firstAccessibleHouseholdId = async (input: {
	platform?: App.Platform;
	database: D1Database;
	households: Array<{ id: string }>;
}): Promise<string | null> => {
	for (const household of input.households) {
		if (await hasHouseholdAccess({ ...input, householdId: household.id })) return household.id;
	}
	return null;
};
