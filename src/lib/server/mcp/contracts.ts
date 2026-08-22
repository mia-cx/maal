import { Data, Schema } from 'effect';

export const MAAL_API_SCOPES = [
	'households:read',
	'households:write',
	'recipes:read',
	'recipes:write',
	'meals:read',
	'meals:write',
	'check_ins:read',
	'check_ins:write',
	'food_profile:read',
	'food_profile:write'
] as const;
export const MaalApiScopeSchema = Schema.Literal(...MAAL_API_SCOPES);
export type MaalApiScope = typeof MaalApiScopeSchema.Type;

export const MCP_KEY_PRESETS = ['read_only_planner', 'meal_planner', 'full_access'] as const;
export const McpKeyPresetSchema = Schema.Literal(...MCP_KEY_PRESETS);
export type McpKeyPreset = typeof McpKeyPresetSchema.Type;

export const MCP_GRANT_MODES = ['all', 'selected'] as const;
export type McpGrantMode = (typeof MCP_GRANT_MODES)[number];

export const MCP_KEY_PREFIX = 'mk_';

export const presetScopes = (preset: McpKeyPreset): readonly MaalApiScope[] => {
	if (preset === 'read_only_planner') {
		return ['households:read', 'recipes:read', 'meals:read'];
	}
	if (preset === 'meal_planner') {
		return ['households:read', 'recipes:read', 'meals:read', 'meals:write', 'check_ins:write'];
	}
	return [...MAAL_API_SCOPES];
};

export interface McpKeyRecord {
	readonly id: string;
	readonly ownerUserId: string;
	readonly keyHash: string;
	readonly label: string;
	readonly preset: McpKeyPreset | null;
	readonly grantMode: McpGrantMode;
	readonly scopes: readonly MaalApiScope[];
	readonly selectedHouseholdIds: readonly string[];
	readonly createdAt: string;
	readonly expiresAt: string | null;
	readonly revokedAt: string | null;
	readonly lastUsedAt: string | null;
}

export type McpKeyHouseholdScope =
	| { readonly kind: 'all' }
	| { readonly kind: 'households'; readonly householdIds: readonly string[] };

export interface PublicMcpKey extends Omit<McpKeyRecord, 'keyHash' | 'ownerUserId'> {
	readonly ownerUserId?: never;
	readonly householdScope: McpKeyHouseholdScope;
}

export interface CreatedMcpKey {
	readonly key: string;
	readonly record: PublicMcpKey;
}

export interface McpEffectiveHousehold {
	readonly householdId: string;
	readonly householdName: string;
	readonly membershipId: string;
	readonly roleSlug: string;
	readonly permissions: readonly string[];
}

export interface McpPrincipal {
	readonly keyId: string;
	readonly ownerUserId: string;
	readonly scopes: readonly MaalApiScope[];
	readonly effectiveHouseholds: readonly McpEffectiveHousehold[];
	readonly authenticatedAt: string;
}

export class McpAuthenticationError extends Data.TaggedError('McpAuthenticationError')<{
	readonly code: 'missing_key' | 'malformed_key' | 'invalid_key';
}> {}

export class McpAuthorizationError extends Data.TaggedError('McpAuthorizationError')<{
	readonly code: 'no_remote_service';
}> {}

export class McpAuthorizationUnavailable extends Data.TaggedError('McpAuthorizationUnavailable')<{
	readonly code: 'workos_unavailable' | 'd1_unavailable';
}> {}

export class RemoteComputeRateLimited extends Data.TaggedError('RemoteComputeRateLimited')<{
	readonly code: 'rate_limited';
}> {}
