import { tryCreateAuthRuntime } from '$lib/server/auth/workos';
import { loadFreshBillingStatus } from './subscriptions';

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
const lifetimeGrantPresenceKeys = ['lifetime_grant', 'maal_lifetime_grant'];
const grantCacheTtlMs = 60_000;
const grantCache = new Map<string, { value: boolean; expiresAt: number }>();

const cachedGrant = (householdId: string): boolean | null => {
	const cached = grantCache.get(householdId);
	if (!cached) return null;
	if (cached.expiresAt > Date.now()) return cached.value;
	grantCache.delete(householdId);
	return null;
};

const splitGrantList = (value: unknown): string[] =>
	typeof value === 'string'
		? value
				.split(/[\s,;]+/)
				.map((token) => token.trim())
				.filter(Boolean)
		: [];

const hasMetadataKey = (metadata: Record<string, unknown>, key: string): boolean =>
	Object.hasOwn(metadata, key) && metadata[key] !== null && metadata[key] !== undefined;

const billingGrantTokens = (metadata: Record<string, unknown>): Set<string> => {
	const tokens = new Set<string>();
	for (const key of grantMetadataKeys) {
		for (const token of splitGrantList(metadata[key])) tokens.add(token);
	}
	if (lifetimeGrantPresenceKeys.some((key) => hasMetadataKey(metadata, key))) {
		tokens.add('lifetime');
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
	const cached = cachedGrant(input.householdId);
	if (cached !== null) return cached;

	const runtime = tryCreateAuthRuntime(input.platform);
	if (!runtime) return false;
	const organization = await runtime.workos.organizations.getOrganization(input.householdId);
	const value = grantsHouseholdAccess(
		billingGrantTokens(organization.metadata ?? {}),
		input.householdId
	);
	grantCache.set(input.householdId, { value, expiresAt: Date.now() + grantCacheTtlMs });
	return value;
};

export const hasHouseholdAccess = async (input: {
	platform?: App.Platform;
	householdId: string;
}): Promise<boolean> => {
	if (await hasHouseholdBillingGrant(input).catch(() => false)) return true;
	return (await loadFreshBillingStatus(input.platform, input.householdId)).isPaid;
};

export const firstAccessibleHouseholdId = async (input: {
	platform?: App.Platform;
	households: Array<{ id: string }>;
}): Promise<string | null> => {
	for (const household of input.households) {
		if (await hasHouseholdAccess({ ...input, householdId: household.id })) return household.id;
	}
	return null;
};
