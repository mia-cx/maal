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
const lifetimeGrantPresenceKeys = ['lifetime_grant', 'maal_lifetime_grant'];
const accessCacheTtlMs = 60_000;
const accessCache = new Map<string, { value: boolean; expiresAt: number }>();
const grantCache = new Map<string, { value: boolean; expiresAt: number }>();

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
	const cached = grantCache.get(input.householdId);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	const runtime = tryCreateAuthRuntime(input.platform);
	if (!runtime) return false;
	const organization = await runtime.workos.organizations.getOrganization(input.householdId);
	const value = grantsHouseholdAccess(
		billingGrantTokens(organization.metadata ?? {}),
		input.householdId
	);
	grantCache.set(input.householdId, { value, expiresAt: Date.now() + accessCacheTtlMs });
	return value;
};

export const hasHouseholdAccess = async (input: {
	platform?: App.Platform;
	database: D1Database;
	householdId: string;
}): Promise<boolean> => {
	const cacheKey = input.householdId;
	const cached = accessCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	if (await hasHouseholdBillingGrant(input).catch(() => false)) {
		accessCache.set(cacheKey, { value: true, expiresAt: Date.now() + accessCacheTtlMs });
		return true;
	}
	const billing = await loadBillingStatus(input.database, input.householdId);
	accessCache.set(cacheKey, { value: billing.isPaid, expiresAt: Date.now() + accessCacheTtlMs });
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
