import type { AuthSession } from '$lib/server/auth/session';
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

const splitGrantList = (value: string | null | undefined): string[] =>
	(value ?? '')
		.split(/[\s,;]+/)
		.map((token) => token.trim())
		.filter(Boolean);

export const billingGrantTokens = (session: AuthSession): Set<string> => {
	const tokens = new Set<string>();
	for (const token of [...session.entitlements, ...session.featureFlags]) tokens.add(token);
	for (const key of ['maal_entitlement', 'maal_entitlements', 'maal_grant', 'maal_grants']) {
		for (const token of splitGrantList(session.user.metadata[key])) tokens.add(token);
	}
	return tokens;
};

export const hasBillingGrant = (session: AuthSession, householdId: string): boolean => {
	const grants = billingGrantTokens(session);
	if ([...globalGrantTokens].some((token) => grants.has(token))) return true;
	return grants.has(`maal:household:${householdId}`) || grants.has(`household:${householdId}`);
};

export const hasHouseholdAccess = async (input: {
	database: D1Database;
	session: AuthSession;
	householdId: string;
}): Promise<boolean> => {
	if (hasBillingGrant(input.session, input.householdId)) return true;
	const billing = await loadBillingStatus(input.database, input.householdId);
	return billing.isPaid;
};

export const firstAccessibleHouseholdId = async (input: {
	database: D1Database;
	session: AuthSession;
	households: Array<{ id: string }>;
}): Promise<string | null> => {
	for (const household of input.households) {
		if (await hasHouseholdAccess({ ...input, householdId: household.id })) return household.id;
	}
	return null;
};
