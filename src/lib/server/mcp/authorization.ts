import type { LiveWorkOSMembership } from '$lib/server/auth-slots/adapter.js';
import { authSlotAdapterFor } from '$lib/server/auth-slots/index.js';

import {
	MCP_KEY_PREFIX,
	McpAuthenticationError,
	McpAuthorizationError,
	McpAuthorizationUnavailable,
	type McpEffectiveHousehold,
	type McpPrincipal
} from './contracts.js';
import { McpKeyRepository } from './keys.js';

interface D1CapabilityRow {
	household_id: string;
	membership_id: string;
	role_slug: string;
	permissions: string;
	status: string;
	billing_status: string | null;
	grace_until: string | null;
	deletion_state: string | null;
}

export interface LiveMembershipProvider {
	listActiveMemberships(userId: string): Promise<readonly LiveWorkOSMembership[]>;
}

const bearerKey = (request: Request): string => {
	const value = request.headers.get('authorization');
	if (value === null) throw new McpAuthenticationError({ code: 'missing_key' });
	const match = /^Bearer (mk_[A-Za-z0-9_-]{43})$/.exec(value);
	if (!match?.[1]?.startsWith(MCP_KEY_PREFIX)) {
		throw new McpAuthenticationError({ code: 'malformed_key' });
	}
	return match[1];
};

const stringArray = (encoded: string): readonly string[] => {
	try {
		const value: unknown = JSON.parse(encoded);
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string')
			: [];
	} catch {
		return [];
	}
};

const planAllowsRemote = (row: D1CapabilityRow, now: string): boolean =>
	row.billing_status === 'active' ||
	row.billing_status === 'trialing' ||
	((row.billing_status === 'past_due' || row.billing_status === 'paused') &&
		row.grace_until !== null &&
		row.grace_until > now);

const membershipProviderFor = (environment: Env): LiveMembershipProvider => ({
	listActiveMemberships: (userId) => authSlotAdapterFor(environment).listActiveMemberships(userId)
});

export const authorizeMcpRequest = async (input: {
	request: Request;
	environment: Env;
	now?: string;
	membershipProvider?: LiveMembershipProvider;
}): Promise<McpPrincipal> => {
	const rawKey = bearerKey(input.request);
	const now = input.now ?? new Date().toISOString();
	const repository = new McpKeyRepository(input.environment.DB);
	let key;
	try {
		key = await repository.byRawKey(rawKey);
	} catch {
		throw new McpAuthorizationUnavailable({ code: 'd1_unavailable' });
	}
	if (!key || key.revokedAt !== null || (key.expiresAt !== null && key.expiresAt <= now)) {
		throw new McpAuthenticationError({ code: 'invalid_key' });
	}
	try {
		await repository.touch(key.id, now);
	} catch {
		throw new McpAuthorizationUnavailable({ code: 'd1_unavailable' });
	}

	let liveMemberships: readonly LiveWorkOSMembership[];
	try {
		liveMemberships = await (
			input.membershipProvider ?? membershipProviderFor(input.environment)
		).listActiveMemberships(key.ownerUserId);
	} catch {
		throw new McpAuthorizationUnavailable({ code: 'workos_unavailable' });
	}
	if (liveMemberships.length === 0) {
		throw new McpAuthorizationError({ code: 'no_remote_service' });
	}

	let rows: readonly D1CapabilityRow[];
	try {
		const placeholders = liveMemberships.map(() => '?').join(', ');
		rows = (
			await input.environment.DB.prepare(
				`SELECT hm.household_id, hm.membership_id, hm.role_slug, hm.permissions, hm.status,
				        bs.status AS billing_status, bs.grace_until,
				        hdr.state AS deletion_state
				 FROM household_memberships hm
				 LEFT JOIN billing_subscriptions bs ON bs.household_id = hm.household_id
				 LEFT JOIN household_deletion_requests hdr ON hdr.household_id = hm.household_id
				 WHERE hm.workos_user_id = ? AND hm.household_id IN (${placeholders})`
			)
				.bind(key.ownerUserId, ...liveMemberships.map(({ householdId }) => householdId))
				.all<D1CapabilityRow>()
		).results;
	} catch {
		throw new McpAuthorizationUnavailable({ code: 'd1_unavailable' });
	}

	const liveByHousehold = new Map(liveMemberships.map((row) => [row.householdId, row]));
	const selected = new Set(key.selectedHouseholdIds);
	const effectiveHouseholds: McpEffectiveHousehold[] = [];
	for (const row of rows) {
		const live = liveByHousehold.get(row.household_id);
		if (!live || row.status !== 'active') continue;
		if (row.membership_id !== live.membershipId || row.role_slug !== live.roleSlug) continue;
		if (key.grantMode === 'selected' && !selected.has(row.household_id)) continue;
		if (!planAllowsRemote(row, now)) continue;
		if (row.deletion_state !== null) continue;
		const projectedPermissions = new Set(stringArray(row.permissions));
		effectiveHouseholds.push({
			householdId: row.household_id,
			householdName: live.householdName,
			membershipId: row.membership_id,
			roleSlug: live.roleSlug,
			permissions: live.permissions.filter((permission) => projectedPermissions.has(permission))
		});
	}
	if (effectiveHouseholds.length === 0) {
		throw new McpAuthorizationError({ code: 'no_remote_service' });
	}
	return {
		keyId: key.id,
		ownerUserId: key.ownerUserId,
		scopes: key.scopes,
		effectiveHouseholds,
		authenticatedAt: now
	};
};

export const mcpAuthorizationResponse = (cause: unknown): Response => {
	if (cause instanceof McpAuthenticationError) {
		return Response.json(
			{ error: 'invalid_mcp_key' },
			{
				status: 401,
				headers: {
					'cache-control': 'no-store',
					'www-authenticate': 'Bearer realm="Maal MCP", error="invalid_token"'
				}
			}
		);
	}
	if (cause instanceof McpAuthorizationError) {
		return Response.json(
			{ error: cause.code },
			{ status: 403, headers: { 'cache-control': 'no-store' } }
		);
	}
	return Response.json(
		{ error: 'mcp_authorization_unavailable' },
		{ status: 503, headers: { 'cache-control': 'no-store' } }
	);
};
